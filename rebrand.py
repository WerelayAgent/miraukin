import os
import re

def rebrand_file(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
            
        original = content
        
        # Twitter links
        content = re.sub(r'https?://(?:www\.)?(twitter|x)\.com/[^\s"\'<>]+', 'https://x.com/miraukin', content)
        
        # Domains
        content = content.replace('trademeraki.com', 'miraukin.com')
        content = content.replace('trademeraki', 'miraukin')
        content = content.replace('TradeMeraki', 'Miraukin')
        
        # Words
        content = content.replace('Meraki', 'Miraukin')
        content = content.replace('meraki', 'miraukin')
        
        if content != original:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)
            print(f"Rebranded: {filepath}")
            
    except Exception as e:
        print(f"Error on {filepath}: {e}")

def main():
    for root, dirs, files in os.walk('.'):
        for file in files:
            if file.endswith(('.html', '.css', '.js')):
                filepath = os.path.join(root, file)
                rebrand_file(filepath)
                
if __name__ == '__main__':
    main()
