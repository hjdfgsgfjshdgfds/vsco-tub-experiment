import requests
import sys
import os
from curl_cffi import requests as cffi_requests

site_id = "244654511" # emmaduffy1
headers={
    "accept": "application/json",
    "authorization": f"Bearer {os.environ['VSCO_AUTH_TOKEN']}",
}

print("Checking follow status (GET)")
resp = cffi_requests.get(f"https://vsco.co/api/2.0/follows/{site_id}", headers=headers, impersonate="chrome")
print(resp.status_code, resp.json() if resp.text else "")

print("\nFollowing (POST)")
resp = cffi_requests.post(f"https://vsco.co/api/2.0/follows/{site_id}", headers=headers, impersonate="chrome")
print(resp.status_code, resp.json() if resp.text else "")
