from json import load
from base64 import b64decode
from gzip import open as gzip_open
from tempfile import TemporaryFile

with open("./tape-directory/42497dee-c685-497e-8f80-46c2875ab4b1.json") as file:
    payload = load(file)
    for item in payload:
        print(item["request"]["url"])
        if item["request"]["url"] == "https://www.aviatornation.com/collections/new-arrivals/products/5-stripe-hoodie-ocean-2":
            print(item["request"])
            print("Body", b64decode(item["response"]["body"]))
            print("Headers", item["response"]["headers"])

            with TemporaryFile() as tmp:
                tmp.write(b64decode(item["response"]["body"]))
                tmp.seek(0)
                with gzip_open(tmp) as gz:
                    print(gz.read())
            break

#with open("./tape-directory/42497dee-c685-497e-8f80-46c2875ab4b1.json") as file:
#    print(file.read(200))
