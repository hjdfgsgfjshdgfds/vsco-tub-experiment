import requests
import os
from curl_cffi import requests as cffi_requests
import pprint

headers={
    "accept": "application/json",
    "authorization": f"Bearer {os.environ['VSCO_AUTH_TOKEN']}",
}
url_new = "https://vsco.co/api/2.0/collections/61c70043d1ad0757d0754b26/reposts?page=1&size=60"
resp = cffi_requests.get(url_new, headers=headers, impersonate="chrome")
r = resp.json()
print("reposts:", len(r.get("medias", [])))
