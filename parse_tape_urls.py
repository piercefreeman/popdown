from json import load

with open("./tape-directory/42497dee-c685-497e-8f80-46c2875ab4b1.json") as file:
    payload = load(file)
    for item in payload:
        print(item["request"]["url"])

#with open("./tape-directory/42497dee-c685-497e-8f80-46c2875ab4b1.json") as file:
#    print(file.read(200))
