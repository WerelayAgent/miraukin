import os

def fix_ca():
    for root, _, files in os.walk('.'):
        for f in files:
            if f.endswith(('.html', '.js', '.css')):
                path = os.path.join(root, f)
                try:
                    with open(path, 'r', encoding='utf-8') as file:
                        content = file.read()
                        
                    original = content
                    content = content.replace('coming soon on pump.fun', '9PviLSRnFtWrDfdz5wE25opzscqDvxZe9Rzk69qWpump')
                    
                    if content != original:
                        with open(path, 'w', encoding='utf-8') as file:
                            file.write(content)
                        print(f'Updated CA in {path}')
                except Exception as e:
                    print(f'Failed on {path}: {e}')

if __name__ == '__main__':
    fix_ca()
