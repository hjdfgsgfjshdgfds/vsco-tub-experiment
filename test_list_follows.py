import requests
import os
from curl_cffi import requests as cffi_requests
import pprint

headers={
    "accept": "application/json",
    "authorization": f"Bearer {os.environ['VSCO_AUTH_TOKEN']}",
}

for url in [
    "https://vsco.co/api/2.0/users/me/following",
    "https://vsco.co/api/2.0/follows",
]:
    print(f"Trying {url}")
    resp = cffi_requests.get(url, headers=headers, impersonate="chrome")
    print(resp.status_code)
    try:
        print(list(resp.json().keys()))
    except:
        print(resp.text[:100])
