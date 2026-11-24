#!/usr/bin/env python3
"""Write docs/app-store/listing.md, the readable copy of docs/app-store/listing.json.

listing.json is what .github/scripts/app_store_listing.py sends to App Store Connect; listing.md shows the same text
with character counts, for reading and pasting. Every block in listing.md comes from listing.json, so the two cannot
drift: change listing.json, then run this script.

    python3 .github/scripts/app_store_listing_md.py           write listing.md
    python3 .github/scripts/app_store_listing_md.py --check   exit 1 if listing.md is not what listing.json gives
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DIR = os.path.join(ROOT, 'docs', 'app-store')
L = json.load(open(os.path.join(DIR, 'listing.json'), encoding='utf-8'))
CONF = json.load(open(os.path.join(ROOT, 'desktop', 'src-tauri', 'tauri.conf.json'), encoding='utf-8'))
STORE_CONF = json.load(open(os.path.join(ROOT, 'desktop', 'src-tauri', 'tauri.appstore.conf.json'), encoding='utf-8'))
VERSION = CONF['version']
IOS_MIN = CONF['bundle']['iOS']['minimumSystemVersion']
MAC_MIN = STORE_CONF['bundle']['macOS']['minimumSystemVersion']

# App Store Connect's limits, in characters (keywords also in bytes).
LIMITS = {'name': 30, 'subtitle': 30, 'promotionalText': 170, 'description': 4000, 'keywords': 100,
          'whatsNew': 4000, 'notes': 4000}
NAME = 'Cowdrey.PDF PDF Editor'  # set in App Store Connect, not by the listing script
CATEGORIES = {'PRODUCTIVITY': 'Productivity', 'BUSINESS': 'Business'}
SHOT_KINDS = {'APP_IPHONE_67': 'iPhone 6.9-inch display, 1320 x 2868', 'APP_IPAD_PRO_3GEN_129': 'iPad 13-inch display, 2064 x 2752',
              'APP_DESKTOP': 'Mac, 2880 x 1800'}


def block(title, text, limit=None):
    count = f' ({len(text)}/{limit})' if limit else f' ({len(text)})'
    return f'## {title}{count}\n\n```\n{text}\n```\n'


def keywords(title, text):
    b = len(text.encode('utf-8'))
    return (f'## {title} ({b}/{LIMITS["keywords"]} bytes, {len(text)} characters)\n\n```\n{text}\n```\n\n'
            'No words from the name or subtitle (cowdrey, pdf, editor, edit, sign, fill, free), no spaces after commas, '
            'no plural repeats.\n')


def shots(groups):
    out = []
    for kind, files in groups.items():
        out.append(f'{SHOT_KINDS.get(kind, kind)} (`{kind}`), in this order:\n')
        out += [f'{i}. `{f}`' for i, f in enumerate(files, 1)]
        out.append('')
    return '\n'.join(out)


def render():
    m = L['mac']
    p = []
    p.append('# Cowdrey.PDF: App Store listing (iPhone, iPad and Mac)\n')
    p.append('Made from [`listing.json`](listing.json) by `.github/scripts/app_store_listing_md.py`: change listing.json and '
             'run the script, never this file by hand. listing.json is what `.github/scripts/app_store_listing.py` sends to '
             'App Store Connect. All counts are characters, measured on the exact text in the block (no trailing newline). '
             'Keywords are also counted in bytes.\n')
    p.append(f'Version {VERSION}. Minimum OS: iOS {IOS_MIN} / iPadOS {IOS_MIN}, macOS {MAC_MIN}. No sign-in or demo '
             'account required.\n')
    p.append('# iPhone and iPad\n')
    p.append(block('App name', NAME, LIMITS['name']))
    p.append('Set in App Store Connect (App Information), not by the listing script.\n')
    p.append(block('Subtitle', L['subtitle'], LIMITS['subtitle']))
    p.append('"Free" is left out of the subtitle: App Review can reject price words in the name or subtitle '
             '(guideline 2.3.7). The price is already shown on the product page, and the description says it is free.\n')
    p.append(block('Promotional text', L['promotionalText'], LIMITS['promotionalText']))
    p.append(block('Description', L['description'], LIMITS['description']))
    p.append(keywords('Keywords', L['keywords']))
    p.append(block('Support URL', L['supportUrl']))
    p.append(block('Marketing URL', L['marketingUrl']))
    p.append(block('Privacy policy URL', L['privacyPolicyUrl']))
    p.append(block('Copyright', L['copyright']))
    p.append(f'## Category\n\n- Primary: {CATEGORIES.get(L["primaryCategory"], L["primaryCategory"])}\n'
             f'- Secondary: {CATEGORIES.get(L["secondaryCategory"], L["secondaryCategory"])}\n')
    p.append(block(f"What's New in {VERSION}", L['whatsNew'], LIMITS['whatsNew']))
    p.append(block('App Review notes', L['review']['notes'], LIMITS['notes']))
    p.append('## Screenshots\n\n' + shots(L['screenshots']))
    p.append('# Mac\n')
    p.append('The Mac App Store version of the same app (universal purchase): the same name, subtitle, URLs, copyright '
             'and categories as above, with this text and these screenshots.\n')
    p.append(block('Promotional text', m['promotionalText'], LIMITS['promotionalText']))
    p.append(block('Description', m['description'], LIMITS['description']))
    p.append(keywords('Keywords', m['keywords']))
    p.append(block(f"What's New in {VERSION}", m['whatsNew'], LIMITS['whatsNew']))
    p.append(block('App Review notes', m['review']['notes'], LIMITS['notes']))
    p.append('## Screenshots\n\n' + shots(m['screenshots']))
    return '\n'.join(p).rstrip('\n') + '\n'


def main():
    over = []
    for where, d in (('iPhone and iPad', L), ('Mac', L['mac'])):
        for k in ('subtitle', 'promotionalText', 'description', 'whatsNew'):
            if k in d and len(d[k]) > LIMITS[k]:
                over.append(f'{where} {k}: {len(d[k])}/{LIMITS[k]}')
        if len(d['keywords'].encode('utf-8')) > LIMITS['keywords']:
            over.append(f'{where} keywords: {len(d["keywords"].encode("utf-8"))}/{LIMITS["keywords"]} bytes')
        if len(d['review']['notes']) > LIMITS['notes']:
            over.append(f'{where} review notes: {len(d["review"]["notes"])}/{LIMITS["notes"]}')
    if over:
        sys.exit('Over App Store Connect limits: ' + '; '.join(over))
    path = os.path.join(DIR, 'listing.md')
    text = render()
    if '--check' in sys.argv[1:]:
        have = open(path, encoding='utf-8').read() if os.path.exists(path) else ''
        if have != text:
            sys.exit('docs/app-store/listing.md does not match listing.json: run python3 .github/scripts/app_store_listing_md.py')
        print('docs/app-store/listing.md matches listing.json')
        return
    open(path, 'w', encoding='utf-8').write(text)
    print('wrote docs/app-store/listing.md')


if __name__ == '__main__':
    main()
