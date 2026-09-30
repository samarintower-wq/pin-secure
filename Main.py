import os, re, time, uuid, base64
from datetime import datetime, timedelta, timezone
from functools import wraps

import bcrypt
import jwt
import requests
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from pymongo import MongoClient, ASCENDING, DESCENDING
from bson import ObjectId

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
app = Flask(__name__, static_folder=BASE_DIR)
CORS(app)

MONGODB_URI = os.getenv("MONGODB_URI", "")
MONGODB_DB = os.getenv("MONGODB_DB", "pin_federation")
JWT_SECRET = os.getenv("JWT_SECRET", "CHANGE_ME_IN_RENDER")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
CLOUDFLARE_API_TOKEN = os.getenv("CLOUDFLARE_API_TOKEN", "")
CLOUDFLARE_ACCOUNT_ID = os.getenv("CLOUDFLARE_ACCOUNT_ID", "")
CLOUDFLARE_IMAGE_MODEL = os.getenv("CLOUDFLARE_IMAGE_MODEL", "@cf/black-forest-labs/flux-1-schnell")
OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY", "")

mongo = MongoClient(MONGODB_URI) if MONGODB_URI else None
db = mongo[MONGODB_DB] if mongo else None
users = db.users if db is not None else None
mailboxes = db.mailboxes if db is not None else None
messages = db.messages if db is not None else None
ai_messages = db.ai_messages if db is not None else None

if db is not None:
    users.create_index("email", unique=True, sparse=True)
    users.create_index("username", unique=True)
    mailboxes.create_index("address", unique=True)
    messages.create_index([("owner_id", ASCENDING), ("created_at", DESCENDING)])
    messages.create_index("delete_at", ASCENDING)
    ai_messages.create_index([("owner_id", ASCENDING), ("created_at", ASCENDING)])

def jsonable(doc):
    if not doc: return doc
    doc = dict(doc)
    if "_id" in doc: doc["_id"] = str(doc["_id"])
    return doc

def token_for(user):
    payload = {
        "sub": str(user["_id"]),
        "exp": datetime.now(timezone.utc) + timedelta(days=7)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")

def auth_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        h = request.headers.get("Authorization", "")
        if not h.startswith("Bearer "):
            return jsonify({"error": "Требуется авторизация"}), 401
        try:
            payload = jwt.decode(h[7:], JWT_SECRET, algorithms=["HS256"])
            user = users.find_one({"_id": ObjectId(payload["sub"])})
            if not user: raise ValueError()
        except Exception:
            return jsonify({"error": "Недействительная сессия"}), 401
        return fn(user, *args, **kwargs)
    return wrapper

def clean_username(s):
    s = (s or "").strip().lower()
    if not re.fullmatch(r"[a-z0-9._-]{3,30}", s):
        return None
    return s

@app.get("/")
def index():
    return send_from_directory(BASE_DIR, "index.html")

@app.get("/api/health")
def health():
    ok = False
    if db is not None:
        try: db.command("ping"); ok = True
        except Exception: pass
    return jsonify({"ok": True, "mongodb": ok})

@app.post("/api/auth/register")
def register():
    if db is None: return jsonify({"error":"MongoDB не настроена"}), 500
    data = request.get_json() or {}
    fields = ["first_name","last_name","birth_year","position","rank","password"]
    if any(not str(data.get(x,"")).strip() for x in fields):
        return jsonify({"error":"Заполните все поля"}), 400
    try: year = int(data["birth_year"])
    except: return jsonify({"error":"Некорректный год рождения"}), 400
    if len(data["password"]) < 8:
        return jsonify({"error":"Пароль должен содержать минимум 8 символов"}), 400
    if users.find_one({"passport.first_name": data["first_name"].strip(),
                       "passport.last_name": data["last_name"].strip(),
                       "passport.birth_year": year}):
        return jsonify({"error":"Пользователь с такими паспортными данными уже зарегистрирован"}), 409
    user = {
        "passport": {
            "first_name": data["first_name"].strip(),
            "last_name": data["last_name"].strip(),
            "birth_year": year,
            "position": data["position"].strip(),
            "rank": data["rank"].strip()
        },
        "password_hash": bcrypt.hashpw(data["password"].encode(), bcrypt.gensalt()).decode(),
        "username": uuid.uuid4().hex,
        "created_at": datetime.now(timezone.utc),
        "settings": {"two_factor": False}
    }
    r = users.insert_one(user); user["_id"] = r.inserted_id
    return jsonify({"token": token_for(user), "user": jsonable(user)})

@app.post("/api/auth/login")
def login():
    data = request.get_json() or {}
    first, last = data.get("first_name","").strip(), data.get("last_name","").strip()
    user = users.find_one({"passport.first_name": first, "passport.last_name": last})
    if not user or not bcrypt.checkpw(data.get("password","").encode(), user["password_hash"].encode()):
        return jsonify({"error":"Неверные данные для входа"}), 401
    return jsonify({"token": token_for(user), "user": jsonable(user)})

@app.get("/api/me")
@auth_required
def me(user):
    return jsonify({"user": jsonable(user)})

@app.post("/api/pinmail/create")
@auth_required
def create_pinmail(user):
    data = request.get_json() or {}
    username = clean_username(data.get("username"))
    if not username: return jsonify({"error":"Используйте 3–30 символов: a-z, 0-9, точка, _ или -"}), 400
    since = datetime.now(timezone.utc) - timedelta(days=1)
    count = mailboxes.count_documents({"owner_id": str(user["_id"]), "created_at": {"$gte": since}})
    if count >= 5: return jsonify({"error":"Лимит: 5 почтовых адресов за 24 часа"}), 429
    address = username + "@pinmail.pin"
    if mailboxes.find_one({"address": address}): return jsonify({"error":"Этот адрес уже занят"}), 409
    box = {"owner_id": str(user["_id"]), "address":address,
           "username":username, "created_at":datetime.now(timezone.utc)}
    mailboxes.insert_one(box)
    return jsonify({"mailbox": jsonable(box)})

@app.get("/api/pinmail")
@auth_required
def pinmail_list(user):
    return jsonify({"mailboxes":[jsonable(x) for x in mailboxes.find({"owner_id":str(user["_id"])}).sort("created_at", DESCENDING)]})

@app.post("/api/pinmail/settings")
@auth_required
def pinmail_settings(user):
    data=request.get_json() or {}
    users.update_one({"_id":user["_id"]},{"$set":{"settings.two_factor":bool(data.get("two_factor"))}})
    return jsonify({"ok":True})

@app.get("/api/mail/<mailbox_id>")
@auth_required
def mailbox_messages(user, mailbox_id):
    box=mailboxes.find_one({"_id":ObjectId(mailbox_id),"owner_id":str(user["_id"])})
    if not box: return jsonify({"error":"Почта не найдена"}),404
    messages.delete_many({"delete_at":{"$lte":datetime.now(timezone.utc)}})
    rows=list(messages.find({"owner_id":str(user["_id"]),"mailbox_id":mailbox_id,"folder":{"$ne":"trash"}}).sort("created_at",DESCENDING))
    return jsonify({"messages":[jsonable(x) for x in rows]})

@app.post("/api/mail/message")
@auth_required
def send_mail(user):
    data=request.get_json() or {}
    required=["mailbox_id","to","subject","body"]
    if any(not str(data.get(k,"")).strip() for k in required): return jsonify({"error":"Заполните поля письма"}),400
    box=mailboxes.find_one({"_id":ObjectId(data["mailbox_id"]),"owner_id":str(user["_id"])})
    if not box:return jsonify({"error":"Почта не найдена"}),404
    # This is an internal Pinmail message model. External SMTP can be added later.
    doc={"owner_id":str(user["_id"]),"mailbox_id":data["mailbox_id"],
         "from":box["address"],"to":data["to"],"subject":data["subject"],
         "body":data["body"],"folder":"sent","created_at":datetime.now(timezone.utc)}
    messages.insert_one(doc)
    return jsonify({"message":jsonable(doc)})

@app.post("/api/mail/<message_id>/trash")
@auth_required
def trash_mail(user,message_id):
    r=messages.update_one({"_id":ObjectId(message_id),"owner_id":str(user["_id"])},
                          {"$set":{"folder":"trash","delete_at":datetime.now(timezone.utc)+timedelta(days=7)}})
    return jsonify({"ok":r.modified_count==1})

@app.post("/api/mail/<message_id>/restore")
@auth_required
def restore_mail(user,message_id):
    r=messages.update_one({"_id":ObjectId(message_id),"owner_id":str(user["_id"])},
                          {"$set":{"folder":"inbox"},"$unset":{"delete_at":""}})
    return jsonify({"ok":r.modified_count==1})

@app.delete("/api/mail/<message_id>")
@auth_required
def delete_mail(user,message_id):
    r=messages.delete_one({"_id":ObjectId(message_id),"owner_id":str(user["_id"])})
    return jsonify({"ok":r.deleted_count==1})

def groq_chat(messages_in):
    if not GROQ_API_KEY: raise RuntimeError("GROQ_API_KEY не задан")
    r=requests.post("https://api.groq.com/openai/v1/chat/completions",
        headers={"Authorization":f"Bearer {GROQ_API_KEY}","Content-Type":"application/json"},
        json={"model":os.getenv("GROQ_MODEL","llama-3.3-70b-versatile"),
              "messages":messages_in,"temperature":0.4},timeout=90)
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]

@app.post("/api/ai/chat")
@auth_required
def ai_chat(user):
    data=request.get_json() or {}
    text=data.get("message","").strip()
    if not text:return jsonify({"error":"Пустое сообщение"}),400
    system = """Ты ИИ-помощник вымышленной Пинийской Федерации. Отвечай по-русски.
Ты можешь помогать с навигацией по приложению, Pinmail, Госуслугами и погодой.
Если пользователь явно просит действие внутри приложения, начинай ответ с ACTION:
и одной из команд OPEN_MAIL, OPEN_GOV, CREATE_MAIL:username.
Не выполняй опасные или необратимые действия без явного подтверждения."""
    history=list(ai_messages.find({"owner_id":str(user["_id"])}).sort("created_at",DESCENDING).limit(12))
    history.reverse()
    msgs=[{"role":"system","content":system}]
    msgs += [{"role":x["role"],"content":x["content"]} for x in history]
    msgs.append({"role":"user","content":text})
    try: answer=groq_chat(msgs)
    except Exception as e: return jsonify({"error":str(e)}),502
    now=datetime.now(timezone.utc)
    ai_messages.insert_many([
        {"owner_id":str(user["_id"]),"role":"user","content":text,"created_at":now},
        {"owner_id":str(user["_id"]),"role":"assistant","content":answer,"created_at":now+timedelta(microseconds=1)}
    ])
    return jsonify({"answer":answer})

@app.get("/api/ai/history")
@auth_required
def ai_history(user):
    rows=list(ai_messages.find({"owner_id":str(user["_id"])}).sort("created_at",ASCENDING).limit(200))
    return jsonify({"messages":[jsonable(x) for x in rows]})

@app.get("/api/weather")
@auth_required
def weather(user):
    if not OPENWEATHER_API_KEY:return jsonify({"error":"OPENWEATHER_API_KEY не задан"}),500
    lat=request.args.get("lat"); lon=request.args.get("lon")
    city=request.args.get("city")
    params={"appid":OPENWEATHER_API_KEY,"units":"metric","lang":"ru"}
    if lat and lon: params.update(lat=lat,lon=lon)
    elif city: params["q"]=city
    else:return jsonify({"error":"Укажите city или lat/lon"}),400
    r=requests.get("https://api.openweathermap.org/data/2.5/weather",params=params,timeout=20)
    if not r.ok:return jsonify({"error":"Не удалось получить погоду"}),r.status_code
    return jsonify(r.json())

@app.post("/api/ai/image")
@auth_required
def ai_image(user):
    data=request.get_json() or {}
    prompt=data.get("prompt","").strip()
    if not prompt:return jsonify({"error":"Пустой prompt"}),400
    if not CLOUDFLARE_API_TOKEN or not CLOUDFLARE_ACCOUNT_ID:
        return jsonify({"error":"Cloudflare AI не настроен"}),500
    # Ask Groq to translate/expand the prompt into an image prompt.
    try:
        en=groq_chat([{"role":"system","content":"Translate the user's image request into a detailed English image-generation prompt. Return only the prompt."},
                      {"role":"user","content":prompt}])
    except Exception:
        en=prompt
    url=f"https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/run/{CLOUDFLARE_IMAGE_MODEL}"
    r=requests.post(url,headers={"Authorization":f"Bearer {CLOUDFLARE_API_TOKEN}","Content-Type":"application/json"},
                    json={"prompt":en},timeout=120)
    if not r.ok:return jsonify({"error":"Cloudflare image generation failed","details":r.text[:500]}),502
    ctype=r.headers.get("content-type","")
    if "image" in ctype:
        b64=base64.b64encode(r.content).decode()
        image_url=f"data:{ctype};base64,{b64}"
    else:
        body=r.json()
        image_url=body.get("result",{}).get("image") or body.get("result")
    return jsonify({"prompt":en,"image":image_url})

@app.post("/api/action/create-mail")
@auth_required
def action_create_mail(user):
    return create_pinmail(user)

@app.errorhandler(Exception)
def error(e):
    app.logger.exception(e)
    return jsonify({"error":"Внутренняя ошибка сервера"}),500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT",5000)))
