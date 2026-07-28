import os

def fix_files():
    for root, _, files in os.walk('.'):
        for f in files:
            if f.endswith(('.html', '.js', '.css')):
                path = os.path.join(root, f)
                try:
                    with open(path, 'r', encoding='utf-8') as file:
                        content = file.read()
                        
                    original = content
                    content = content.replace('NVDA', 'WIF')
                    content = content.replace('0x5abca8797404e8c870f24f61b3ccd0ed612c98ef', 'coming soon on pump.fun')
                    
                    if content != original:
                        with open(path, 'w', encoding='utf-8') as file:
                            file.write(content)
                        print(f'Fixed {path}')
                except Exception as e:
                    print(f'Failed on {path}: {e}')

if __name__ == '__main__':
    fix_files()
