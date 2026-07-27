import urllib.request
import os

BASE_URL = 'https://www.trademeraki.com/js/'
modules = [
    'config.js',
    'brand.js',
    'feed.js',
    'bs.js',
    'wallet.js',
    'chart.js',
    'onchain.js',
    'onchain-config.js'
]

def ensure_dir(path):
    if not os.path.exists(path):
        os.makedirs(path)

ensure_dir('js')

for m in modules:
    url = BASE_URL + m
    local_path = 'js/' + m
    print(f"Downloading {url} to {local_path}...")
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response:
            with open(local_path, 'wb') as f:
                f.write(response.read())
    except Exception as e:
        print(f"Failed to download {url}: {e}")
