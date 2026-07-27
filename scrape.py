import urllib.request
import os
import re

BASE_URL = 'https://www.trademeraki.com'

files_to_download = [
    '/',
    '/app.html',
    '/legal.html',
    '/css/tokens.css',
    '/css/base.css',
    '/css/landing.css',
    '/css/app.css',
    '/assets/favicon.png',
    '/assets/apple-touch-icon.png',
    '/assets/hero-bg.mp4',
    '/assets/hero-poster.jpg',
    '/assets/meraki-logo.webp',
    '/assets/app-preview.png',
    '/js/vendor/ethers.min.js',
    '/js/app.js'
]

def ensure_dir(path):
    if not os.path.exists(path):
        os.makedirs(path)

for path in files_to_download:
    url = BASE_URL + path
    if path == '/':
        local_path = 'index.html'
    else:
        local_path = path.lstrip('/')
    
    ensure_dir(os.path.dirname(local_path) or '.')
    
    print(f"Downloading {url} to {local_path}...")
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response:
            data = response.read()
            with open(local_path, 'wb') as f:
                f.write(data)
    except Exception as e:
        print(f"Failed to download {url}: {e}")

# Now, we must scan the HTML/CSS for any missing assets
def extract_missing_assets():
    missing = set()
    for root, dirs, files in os.walk('.'):
        for file in files:
            if file.endswith('.html') or file.endswith('.css') or file.endswith('.js'):
                try:
                    with open(os.path.join(root, file), 'r', encoding='utf-8') as f:
                        content = f.read()
                        # Find url(...) in CSS
                        for match in re.findall(r'url\([\'"]?(.*?)[\'"]?\)', content):
                            if not match.startswith('http') and not match.startswith('data:'):
                                missing.add(match)
                        # Find src="..." in HTML
                        for match in re.findall(r'src="([^"]+)"', content):
                            if not match.startswith('http'):
                                missing.add(match)
                except Exception:
                    pass
    return missing

missing_assets = extract_missing_assets()
for asset in missing_assets:
    # Normalize paths like ../assets/...
    asset_norm = asset.replace('../', '')
    if asset_norm not in [p.lstrip('/') for p in files_to_download]:
        url = BASE_URL + '/' + asset_norm
        print(f"Downloading missing asset {url} to {asset_norm}...")
        try:
            ensure_dir(os.path.dirname(asset_norm) or '.')
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req) as response:
                with open(asset_norm, 'wb') as f:
                    f.write(response.read())
        except Exception as e:
            print(f"Failed to download missing asset {url}: {e}")
