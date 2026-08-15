import json
import os
import pathlib
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path(__file__).parent
COOKIE_FILE = pathlib.Path(os.environ.get('VSCO_COOKIE_FILE', 'cookies.json'))
AUTHORIZATION = f"Bearer {os.environ.get('VSCO_AUTH_TOKEN', '')}" if os.environ.get('VSCO_AUTH_TOKEN') else ''

def cookie_header():
    rows = json.loads(COOKIE_FILE.read_text())
    return '; '.join(f"{row['name']}={row['value']}" for row in rows if row.get('domain', '').endswith('vsco.co'))

class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/__vsco_proxy?'):
            query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
            target = query.get('url', [''])[0]
            if not target.startswith('https://vsco.co/'):
                self.send_error(400, 'Only https://vsco.co targets are allowed')
                return
            req = urllib.request.Request(target, headers={
                'Cookie': cookie_header(),
                'Accept': 'application/json, text/plain, */*',
                'Origin': 'https://vsco.co',
                'Referer': 'https://vsco.co/feed?tab=following',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
                **({'Authorization': AUTHORIZATION} if AUTHORIZATION else {}),
            })
            try:
                with urllib.request.urlopen(req, timeout=60) as response:
                    body = response.read()
                    self.send_response(response.status)
                    self.send_header('Content-Type', response.headers.get('Content-Type', 'application/json'))
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(body)
            except Exception as exc:
                self.send_error(502, str(exc))
            return
        super().do_GET()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.end_headers()

ThreadingHTTPServer(('127.0.0.1', 8765), Handler).serve_forever()
