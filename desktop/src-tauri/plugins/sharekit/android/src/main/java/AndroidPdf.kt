// Cowdrey.PDF's own native features on Android, called through SharePlugin (plugin:sharekit|native):
// - saveAs: Android's save dialog (ACTION_CREATE_DOCUMENT) for a file the app wrote to its cache. It answers only once
//   the person saved or cancelled, so the page knows whether the file was really saved. writeTo saves again to a
//   file saved that way before (Save after Save as).
// - saveToFolder: several files (Split into files) written into one folder the person picks (ACTION_OPEN_DOCUMENT_TREE).
// - printPdf: the PDF itself sent to Android's print service, sharp at any printer's resolution.
// - speak / stopSpeaking / ttsAvailable: Read aloud with Android's text-to-speech (the web view has no speech).
// - systemBars and insets: light or dark status-bar icons to match the theme; the size of the system bars and the
//   keyboard, which the web view does not report on its own, so the page can keep clear of them.
// - takeSharedFiles: PDFs shared several at a time (SEND_MULTIPLE), which the app's own intent handling skips.
// - pickImages / decodeImage / readPart: pictures picked in Android's photo picker, and pictures the web view cannot
//   read (HEIC and HEIF photos), decoded by Android and handed back as JPEG or PNG, read in parts so no single message
//   is large.
// - tsaPost: a trusted timestamp for a certificate signature, posted with Android's own network stack (called only
//   by the app's tsa_post command, src-tauri/src/tsa.rs, never by the page directly).
package app.tauri.share

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintDocumentInfo
import android.print.PrintManager
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.view.View
import android.webkit.WebView
import androidx.activity.result.ActivityResult
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import java.io.File
import java.io.FileOutputStream
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap

class AndroidPdf(private val plugin: SharePlugin, private val activity: Activity) {
    private var webView: WebView? = null
    private val rw = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION

    fun load(webView: WebView) {
        this.webView = webView
        cleanCache()
        watchInsets(webView)
        collectShared(activity.intent)
    }

    fun destroy() {
        try { tts?.shutdown() } catch (_: Exception) {}
        tts = null
    }

    private fun background(invoke: Invoke, work: () -> JSObject) {
        Thread {
            try { invoke.resolve(work()) } catch (e: Exception) { invoke.reject(e.message ?: e.toString()) }
        }.start()
    }

    /** Only files the app wrote to its own cache can be saved or printed from. */
    private fun cacheFile(path: String): File {
        val f = File(if (path.startsWith("file://")) Uri.parse(path).path!! else path).canonicalFile
        val cache = activity.cacheDir.canonicalFile
        if (!f.path.startsWith(cache.path + File.separator)) throw Exception("That file is not one the app made")
        if (!f.isFile) throw Exception("The file to save is missing")
        return f
    }

    /** Copies left in the cache by earlier shares and saves (the cache root and cache/outgoing). */
    private fun cleanCache() {
        Thread {
            try {
                val old = System.currentTimeMillis() - 10 * 60 * 1000
                activity.cacheDir.listFiles()?.forEach { if (it.isFile && it.lastModified() < old) it.delete() }
                for (dir in listOf("outgoing", "pdf")) File(activity.cacheDir, dir).listFiles()?.forEach { if (it.isFile && it.lastModified() < old) it.delete() }
            } catch (_: Exception) {
            }
        }.start()
    }

    private fun name(uri: Uri): String {
        try {
            activity.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst() && !c.isNull(0)) return c.getString(0)
            }
        } catch (_: Exception) {
        }
        return uri.lastPathSegment?.substringAfterLast('/') ?: "Document.pdf"
    }

    private fun copyTo(file: File, uri: Uri) {
        val out = activity.contentResolver.openOutputStream(uri, "wt") ?: throw Exception("Could not write the file")
        out.use { o -> file.inputStream().use { it.copyTo(o) } }
    }

    // ---- saving ----

    private class PendingSave(val file: File)
    private val saves = ConcurrentHashMap<String, PendingSave>()

    fun saveAs(invoke: Invoke) {
        val args = invoke.getArgs()
        val file = try { cacheFile(args.getString("path", "") ?: "") } catch (e: Exception) { invoke.reject(e.message); return }
        val title = args.getString("name", file.name) ?: file.name
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = args.getString("mimeType", "application/pdf") ?: "application/pdf"
            putExtra(Intent.EXTRA_TITLE, title)
            addFlags(rw or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        }
        saves[invoke.callback.toString()] = PendingSave(file)
        plugin.startForResult(invoke, intent, "saveAsResult")
    }

    fun saveAsResult(invoke: Invoke, result: ActivityResult) {
        val pending = saves.remove(invoke.callback.toString())
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null || pending == null) {
            pending?.file?.delete()
            invoke.resolve(JSObject().apply { put("saved", false) })
            return
        }
        background(invoke) {
            try { activity.contentResolver.takePersistableUriPermission(uri, rw) } catch (_: Exception) {}
            copyTo(pending.file, uri)
            pending.file.delete()
            JSObject().apply {
                put("saved", true)
                put("uri", uri.toString())
                put("name", name(uri))
            }
        }
    }

    /** Saves again to a file chosen in the save dialog before (the permission to write it is kept). */
    fun writeTo(invoke: Invoke) {
        val args = invoke.getArgs()
        background(invoke) {
            val file = cacheFile(args.getString("path", "") ?: "")
            val uri = Uri.parse(args.getString("uri", "") ?: "")
            if (uri.scheme != "content") throw Exception("Not a file address")
            try { copyTo(file, uri) } finally { file.delete() }
            JSObject().apply { put("saved", true); put("uri", uri.toString()); put("name", name(uri)) }
        }
    }

    private class PendingFolder(val files: List<File>, val names: List<String>, val types: List<String>)
    private val folders = ConcurrentHashMap<String, PendingFolder>()

    fun saveToFolder(invoke: Invoke) {
        val args = invoke.getArgs()
        try {
            val list = args.getJSONArray("files")
            val files = ArrayList<File>(); val names = ArrayList<String>(); val types = ArrayList<String>()
            for (i in 0 until list.length()) {
                val o = list.getJSONObject(i)
                files.add(cacheFile(o.getString("path"))); names.add(o.optString("name", "File $i")); types.add(o.optString("mimeType", "application/octet-stream"))
            }
            folders[invoke.callback.toString()] = PendingFolder(files, names, types)
        } catch (e: Exception) {
            invoke.reject(e.message ?: "Nothing to save"); return
        }
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply { addFlags(rw) }
        plugin.startForResult(invoke, intent, "saveToFolderResult")
    }

    fun saveToFolderResult(invoke: Invoke, result: ActivityResult) {
        val pending = folders.remove(invoke.callback.toString())
        val tree = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || tree == null || pending == null) {
            pending?.files?.forEach { it.delete() }
            invoke.resolve(JSObject().apply { put("saved", false) })
            return
        }
        background(invoke) {
            val parent = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
            val saved = JSArray()
            for (i in pending.files.indices) {
                // createDocument gives a new name ("Part (1).pdf") when one is taken: nothing is replaced.
                val made = DocumentsContract.createDocument(activity.contentResolver, parent, pending.types[i], pending.names[i])
                    ?: throw Exception("Could not create ${pending.names[i]}")
                copyTo(pending.files[i], made)
                pending.files[i].delete()
                saved.put(name(made))
            }
            JSObject().apply { put("saved", true); put("folder", name(parent)); put("names", saved) }
        }
    }

    // ---- pictures the web view can't read ----

    /** A picture decoded by Android (any kind it reads: JPEG, PNG, HEIC, HEIF, WebP…), the right way up, at most `max`
     *  pixels on its longer side. */
    private fun decodeBitmap(max: Int, file: File?, uri: Uri?): android.graphics.Bitmap =
        if (Build.VERSION.SDK_INT >= 28) {
            val source = if (file != null) android.graphics.ImageDecoder.createSource(file) else android.graphics.ImageDecoder.createSource(activity.contentResolver, uri!!)
            android.graphics.ImageDecoder.decodeBitmap(source) { d, info, _ ->
                val w = info.size.width; val h = info.size.height; val k = minOf(1.0, max.toDouble() / maxOf(w, h))
                if (k < 1.0) d.setTargetSize(maxOf(1, (w * k).toInt()), maxOf(1, (h * k).toInt()))
                d.allocator = android.graphics.ImageDecoder.ALLOCATOR_SOFTWARE
            }
        } else {
            (if (file != null) file.inputStream() else activity.contentResolver.openInputStream(uri!!))?.use { android.graphics.BitmapFactory.decodeStream(it) }
                ?: throw Exception("This picture can't be read on this Android version")
        }

    /** A bitmap written to the app's cache: PNG when it has see-through parts, JPEG otherwise. */
    private fun writePicture(bmp: android.graphics.Bitmap, base: String): JSObject {
        val png = bmp.hasAlpha()
        val dir = File(activity.cacheDir, "outgoing").apply { mkdirs() }
        val out = File(dir, base + if (png) ".png" else ".jpg")
        FileOutputStream(out).use { o ->
            if (!bmp.compress(if (png) android.graphics.Bitmap.CompressFormat.PNG else android.graphics.Bitmap.CompressFormat.JPEG, if (png) 100 else 92, o)) throw Exception("Could not convert the picture")
        }
        val r = JSObject().apply { put("path", out.path); put("size", out.length()); put("width", bmp.width); put("height", bmp.height); put("type", if (png) "image/png" else "image/jpeg") }
        bmp.recycle()
        return r
    }

    /** A picture in the app's cache (HEIC, HEIF…) decoded by Android and written next to it: { path, size, width,
     *  height, type }. */
    fun decodeImage(invoke: Invoke) {
        val args = invoke.getArgs()
        background(invoke) {
            val file = cacheFile(args.getString("path", "") ?: "")
            val max = args.optInt("max", 4000).coerceIn(64, 8000)
            try {
                writePicture(decodeBitmap(max, file, null), file.nameWithoutExtension + " (decoded)")
            } finally { file.delete() }
        }
    }

    /** Pictures for a new PDF, picked in Android's photo picker and read here. (The web view can't read a photo the
     *  picker hands over once the picker has taken its location out, which changes its size: Chrome then refuses the
     *  file. Android reads it as it is.) { files: [{ path, size, name, type, width, height } or { name, error }] } */
    fun pickImages(invoke: Invoke) {
        val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
            type = "image/*"
            addCategory(Intent.CATEGORY_OPENABLE)
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, invoke.getArgs().optBoolean("multiple", true))
        }
        plugin.startForResult(invoke, intent, "pickImagesResult")
    }

    fun pickImagesResult(invoke: Invoke, result: ActivityResult) {
        val data = result.data
        if (result.resultCode != Activity.RESULT_OK || data == null) { invoke.resolve(JSObject().apply { put("files", JSArray()) }); return }
        val uris = ArrayList<Uri>()
        data.clipData?.let { c -> for (i in 0 until c.itemCount) c.getItemAt(i).uri?.let { uris.add(it) } }
        if (uris.isEmpty()) data.data?.let { uris.add(it) }
        background(invoke) {
            val files = JSArray()
            for ((k, uri) in uris.withIndex()) {
                val label = name(uri)
                try {
                    val bmp = decodeBitmap(4000, null, uri)
                    files.put(writePicture(bmp, "picked ${System.nanoTime()} $k").apply { put("name", label) })
                } catch (e: Exception) {
                    files.put(JSObject().apply { put("name", label); put("error", e.message ?: "unreadable") })
                }
            }
            JSObject().apply { put("files", files) }
        }
    }

    /** Part of a file the app made in its cache, as base64 (at most 4 MB); the file is deleted once its end is read. */
    fun readPart(invoke: Invoke) {
        val args = invoke.getArgs()
        background(invoke) {
            val file = cacheFile(args.getString("path", "") ?: "")
            val at = args.optLong("at", 0L).coerceAtLeast(0L)
            val len = args.optInt("length", 4 shl 20).coerceIn(1, 4 shl 20)
            val size = file.length()
            val buf = ByteArray(minOf(len.toLong(), maxOf(0L, size - at)).toInt())
            java.io.RandomAccessFile(file, "r").use { f -> f.seek(at); f.readFully(buf) }
            if (at + buf.size >= size) file.delete()
            JSObject().apply { put("base64", android.util.Base64.encodeToString(buf, android.util.Base64.NO_WRAP)); put("size", size) }
        }
    }

    // ---- printing ----

    fun printPdf(invoke: Invoke) {
        val args = invoke.getArgs()
        val file = try { cacheFile(args.getString("path", "") ?: "") } catch (e: Exception) { invoke.reject(e.message); return }
        val title = (args.getString("name", "Document") ?: "Document").ifBlank { "Document" }
        val pages = args.optInt("pages", PrintDocumentInfo.PAGE_COUNT_UNKNOWN)
        val adapter = object : PrintDocumentAdapter() {
            override fun onLayout(old: PrintAttributes?, new: PrintAttributes?, cancel: CancellationSignal?, callback: LayoutResultCallback, extras: Bundle?) {
                if (cancel?.isCanceled == true) { callback.onLayoutCancelled(); return }
                val info = PrintDocumentInfo.Builder(if (title.endsWith(".pdf", true)) title else "$title.pdf")
                    .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
                    .setPageCount(if (pages > 0) pages else PrintDocumentInfo.PAGE_COUNT_UNKNOWN)
                    .build()
                callback.onLayoutFinished(info, old != new)
            }
            override fun onWrite(range: Array<out PageRange>?, dest: ParcelFileDescriptor, cancel: CancellationSignal?, callback: WriteResultCallback) {
                Thread {
                    try {
                        file.inputStream().use { input -> FileOutputStream(dest.fileDescriptor).use { input.copyTo(it) } }
                        if (cancel?.isCanceled == true) callback.onWriteCancelled() else callback.onWriteFinished(arrayOf(PageRange.ALL_PAGES))
                    } catch (e: Exception) {
                        callback.onWriteFailed(e.message)
                    }
                }.start()
            }
            override fun onFinish() { file.delete() }
        }
        activity.runOnUiThread {
            try {
                val pm = activity.getSystemService(android.content.Context.PRINT_SERVICE) as PrintManager
                pm.print(title, adapter, PrintAttributes.Builder().build())
                invoke.resolve(JSObject().apply { put("started", true) })
            } catch (e: Exception) {
                invoke.reject(e.message ?: "Could not print")
            }
        }
    }

    // ---- read aloud ----

    private var tts: TextToSpeech? = null
    private var ttsState = 0 // 0 starting, 1 ready, -1 none on this device
    private val ttsWaiting = mutableListOf<() -> Unit>()
    private val speaking = ConcurrentHashMap<String, Invoke>()

    private fun withTts(then: () -> Unit) {
        synchronized(ttsWaiting) {
            if (ttsState != 0) { then(); return }
            ttsWaiting.add(then)
            if (ttsStarted) return
            ttsStarted = true
        }
        activity.runOnUiThread {
            val t = TextToSpeech(activity) { status ->
                val all = synchronized(ttsWaiting) {
                    ttsState = if (status == TextToSpeech.SUCCESS) 1 else -1
                    val l = ttsWaiting.toList(); ttsWaiting.clear(); l
                }
                all.forEach { it() }
            }
            t.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(id: String?) {}
                override fun onDone(id: String?) { finish(id, "done") }
                @Deprecated("Deprecated in Java")
                override fun onError(id: String?) { finish(id, "error") }
                override fun onError(id: String?, code: Int) { finish(id, "error") }
                override fun onStop(id: String?, interrupted: Boolean) { finish(id, "stopped") }
            })
            tts = t
        }
    }
    private var ttsStarted = false

    private fun finish(id: String?, how: String) {
        val invoke = id?.let { speaking.remove(it) } ?: return
        invoke.resolve(JSObject().apply { if (how == "error") put("error", "synthesis-failed") else put(how, true) })
    }

    fun ttsAvailable(invoke: Invoke) {
        withTts {
            val t = tts
            val engines = try { t?.engines?.size ?: 0 } catch (_: Exception) { 0 }
            invoke.resolve(JSObject().apply {
                put("available", ttsState == 1 && engines > 0)
                put("engines", engines)
                put("language", Locale.getDefault().toLanguageTag())
            })
        }
    }

    fun speak(invoke: Invoke) {
        val args = invoke.getArgs()
        val text = args.getString("text", "") ?: ""
        val rate = args.optDouble("rate", 1.0).toFloat()
        val lang = args.getString("lang", "") ?: ""
        withTts {
            val t = tts
            if (ttsState != 1 || t == null) { invoke.resolve(JSObject().apply { put("error", "synthesis-unavailable") }); return@withTts }
            if (lang.isNotBlank()) try { t.language = Locale.forLanguageTag(lang) } catch (_: Exception) {}
            t.setSpeechRate(rate.coerceIn(0.1f, 4f))
            val id = "u" + System.nanoTime()
            speaking[id] = invoke
            val r = t.speak(text.take(TextToSpeech.getMaxSpeechInputLength() - 1), TextToSpeech.QUEUE_ADD, null, id)
            if (r != TextToSpeech.SUCCESS) speaking.remove(id)?.resolve(JSObject().apply { put("error", "synthesis-failed") })
        }
    }

    fun stopSpeaking(invoke: Invoke) {
        try { tts?.stop() } catch (_: Exception) {}
        // anything still waiting is answered, so the page's calls don't hang
        for (k in speaking.keys.toList()) speaking.remove(k)?.resolve(JSObject().apply { put("stopped", true) })
        invoke.resolve(JSObject())
    }

    // ---- system bars and insets ----

    fun systemBars(invoke: Invoke) {
        val dark = invoke.getArgs().optBoolean("dark", false)
        activity.runOnUiThread {
            try {
                val c = WindowCompat.getInsetsController(activity.window, activity.window.decorView)
                c.isAppearanceLightStatusBars = !dark
                c.isAppearanceLightNavigationBars = !dark
            } catch (_: Exception) {
            }
            invoke.resolve(JSObject())
        }
    }

    @Volatile private var lastInsets = JSObject().apply { put("top", 0); put("bottom", 0); put("left", 0); put("right", 0); put("keyboard", 0) }

    private fun watchInsets(webView: WebView) {
        activity.runOnUiThread {
            val parent = webView.parent as? View ?: return@runOnUiThread
            val density = activity.resources.displayMetrics.density
            ViewCompat.setOnApplyWindowInsetsListener(parent) { v, insets ->
                val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
                val ime = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
                // With the keyboard up, the web view ends above it, so the page can scroll the field being typed in into view.
                v.setPadding(0, 0, 0, ime)
                val o = JSObject().apply {
                    put("top", Math.round(bars.top / density)); put("bottom", Math.round((if (ime > 0) 0 else bars.bottom) / density))
                    put("left", Math.round(bars.left / density)); put("right", Math.round(bars.right / density))
                    put("keyboard", Math.round(ime / density))
                }
                lastInsets = o
                webView.evaluateJavascript("window.__cowdreyInsets && window.__cowdreyInsets($o)", null)
                insets
            }
            ViewCompat.requestApplyInsets(parent)
        }
    }

    fun insets(invoke: Invoke) { invoke.resolve(lastInsets) }

    /** Where the app was installed from (Google Play updates it itself; a downloaded APK checks GitHub). */
    fun appInfo(invoke: Invoke) {
        val installer = try {
            if (Build.VERSION.SDK_INT >= 30) activity.packageManager.getInstallSourceInfo(activity.packageName).installingPackageName
            else @Suppress("DEPRECATION") activity.packageManager.getInstallerPackageName(activity.packageName)
        } catch (_: Exception) { null }
        invoke.resolve(JSObject().apply { put("installer", installer ?: ""); put("night", night(activity.resources.configuration)) })
    }

    private fun night(c: android.content.res.Configuration) =
        (c.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK) == android.content.res.Configuration.UI_MODE_NIGHT_YES

    /** Dark mode turned on or off while the app is open: the page follows (the web view may not tell it). */
    fun onConfigurationChanged(c: android.content.res.Configuration) {
        webView?.evaluateJavascript("window.__cowdreyNight && window.__cowdreyNight(${night(c)})", null)
    }

    // ---- several PDFs shared at once ----

    private val shared = mutableListOf<String>()

    fun onNewIntent(intent: Intent) {
        if (collectShared(intent)) webView?.post { webView?.evaluateJavascript("window.__cowdreyShared && window.__cowdreyShared()", null) }
    }

    @Suppress("DEPRECATION")
    private fun collectShared(intent: Intent?): Boolean {
        if (intent?.action != Intent.ACTION_SEND_MULTIPLE) return false
        val list: ArrayList<Uri>? = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java) else intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM)
        val uris = list?.map { it.toString() } ?: return false
        synchronized(shared) { shared.addAll(uris) }
        intent.action = Intent.ACTION_MAIN // taken once
        return uris.isNotEmpty()
    }

    fun takeSharedFiles(invoke: Invoke) {
        val uris = synchronized(shared) { val l = shared.toList(); shared.clear(); l }
        background(invoke) {
            val files = JSArray()
            for (u in uris) files.put(JSObject().apply { put("uri", u); put("name", name(Uri.parse(u))) })
            JSObject().apply { put("files", files) }
        }
    }

    // ---- trusted timestamps ----

    /** One https POST of a timestamp request (a few hundred bytes; src-tauri/src/tsa.rs checks it first), with
     *  Android's own network stack: the phone's certificate authorities, its DNS and its proxy settings. */
    fun tsaPost(invoke: Invoke) {
        val args = invoke.getArgs()
        background(invoke) {
            val url = java.net.URL(args.getString("url", "") ?: "")
            if (url.protocol != "https") throw Exception("The timestamp server must use https")
            val body = android.util.Base64.decode(args.getString("body", "") ?: "", android.util.Base64.DEFAULT)
            val c = url.openConnection() as javax.net.ssl.HttpsURLConnection
            try {
                c.requestMethod = "POST"
                c.doOutput = true
                c.connectTimeout = 20000
                c.readTimeout = 30000
                c.instanceFollowRedirects = false
                c.setRequestProperty("Content-Type", "application/timestamp-query")
                c.setRequestProperty("User-Agent", "Cowdrey.PDF")
                c.setFixedLengthStreamingMode(body.size)
                c.outputStream.use { it.write(body) }
                val code = c.responseCode
                if (code !in 200..299) throw Exception("error $code")
                val out = java.io.ByteArrayOutputStream()
                c.inputStream.use { input ->
                    val buf = ByteArray(8192)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        if (out.size() > (1 shl 20)) throw Exception("The answer is too large")
                    }
                }
                JSObject().apply { put("body", android.util.Base64.encodeToString(out.toByteArray(), android.util.Base64.NO_WRAP)) }
            } catch (e: java.io.IOException) {
                // the kind of failure (no network, unknown host, certificate) as well as its message
                throw Exception("${e.javaClass.simpleName}: ${e.message ?: ""}".trimEnd(' ', ':'))
            } finally {
                c.disconnect()
            }
        }
    }
}
