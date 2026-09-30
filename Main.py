import os
import re
import uuid
import base64

from datetime import datetime, timedelta, timezone
from functools import wraps

import bcrypt
import jwt
import requests

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

from pymongo import MongoClient, ASCENDING, DESCENDING
from bson import ObjectId


# =========================================================
# APP
# =========================================================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(
    __name__,
    static_folder=BASE_DIR
)

CORS(app)


# =========================================================
# ENVIRONMENT
# =========================================================

MONGODB_URI = os.getenv("MONGODB_URI", "")
MONGODB_DB = os.getenv(
    "MONGODB_DB",
    "pin_federation"
)

JWT_SECRET = os.getenv(
    "JWT_SECRET",
    "CHANGE_ME_IN_RENDER"
)

GROQ_API_KEY = os.getenv(
    "GROQ_API_KEY",
    ""
)

# Важно:
# актуальная модель Groq по умолчанию.
GROQ_MODEL = os.getenv(
    "GROQ_MODEL",
    "openai/gpt-oss-120b"
)

CLOUDFLARE_API_TOKEN = os.getenv(
    "CLOUDFLARE_API_TOKEN",
    ""
)

CLOUDFLARE_ACCOUNT_ID = os.getenv(
    "CLOUDFLARE_ACCOUNT_ID",
    ""
)

CLOUDFLARE_IMAGE_MODEL = os.getenv(
    "CLOUDFLARE_IMAGE_MODEL",
    "@cf/black-forest-labs/flux-1-schnell"
)

OPENWEATHER_API_KEY = os.getenv(
    "OPENWEATHER_API_KEY",
    ""
)


# =========================================================
# MONGODB
# =========================================================

mongo = None
db = None

users = None
mailboxes = None
messages = None
ai_messages = None


if MONGODB_URI:
    mongo = MongoClient(
        MONGODB_URI,
        serverSelectionTimeoutMS=10000
    )

    db = mongo[MONGODB_DB]

    users = db.users
    mailboxes = db.mailboxes
    messages = db.messages
    ai_messages = db.ai_messages


# =========================================================
# DATABASE INDEXES
# =========================================================

if db is not None:

    try:
        users.create_index(
            "email",
            unique=True,
            sparse=True
        )
    except Exception as e:
        print(
            f"MongoDB index warning users.email: {e}"
        )

    try:
        users.create_index(
            "username",
            unique=True
        )
    except Exception as e:
        print(
            f"MongoDB index warning users.username: {e}"
        )

    try:
        mailboxes.create_index(
            "address",
            unique=True
        )
    except Exception as e:
        print(
            f"MongoDB index warning mailboxes.address: {e}"
        )

    try:
        messages.create_index(
            [
                ("owner_id", ASCENDING),
                ("created_at", DESCENDING)
            ]
        )
    except Exception as e:
        print(
            f"MongoDB index warning messages.created_at: {e}"
        )

    # Отдельно оставляем этот индекс в try/except.
    # Это предотвращает падение приложения на проблемных
    # версиях PyMongo/Python.
    try:
        messages.create_index(
            [
                ("delete_at", ASCENDING)
            ]
        )
    except Exception as e:
        print(
            f"MongoDB index warning messages.delete_at: {e}"
        )

    try:
        ai_messages.create_index(
            [
                ("owner_id", ASCENDING),
                ("created_at", ASCENDING)
            ]
        )
    except Exception as e:
        print(
            f"MongoDB index warning ai_messages: {e}"
        )


# =========================================================
# HELPERS
# =========================================================

def jsonable(doc):
    if not doc:
        return doc

    doc = dict(doc)

    if "_id" in doc:
        doc["_id"] = str(doc["_id"])

    return doc


def token_for(user):

    payload = {
        "sub": str(user["_id"]),
        "exp": (
            datetime.now(timezone.utc)
            + timedelta(days=7)
        )
    }

    return jwt.encode(
        payload,
        JWT_SECRET,
        algorithm="HS256"
    )


def auth_required(fn):

    @wraps(fn)
    def wrapper(*args, **kwargs):

        if users is None:
            return jsonify({
                "error": "MongoDB не настроена"
            }), 500

        header = request.headers.get(
            "Authorization",
            ""
        )

        if not header.startswith("Bearer "):
            return jsonify({
                "error": "Требуется авторизация"
            }), 401

        try:

            payload = jwt.decode(
                header[7:],
                JWT_SECRET,
                algorithms=["HS256"]
            )

            user = users.find_one({
                "_id": ObjectId(payload["sub"])
            })

            if not user:
                raise ValueError(
                    "User not found"
                )

        except Exception:
            return jsonify({
                "error": "Недействительная сессия"
            }), 401

        return fn(
            user,
            *args,
            **kwargs
        )

    return wrapper


def clean_username(value):

    value = (
        value or ""
    ).strip().lower()

    if not re.fullmatch(
        r"[a-z0-9._-]{3,30}",
        value
    ):
        return None

    return value


# =========================================================
# STATIC
# =========================================================

@app.get("/")
def index():
    return send_from_directory(
        BASE_DIR,
        "index.html"
    )

# =========================================================
# STATIC FILES
# =========================================================

@app.get("/style.css")
def style_css():
    return send_from_directory(
        BASE_DIR,
        "style.css",
        mimetype="text/css"
    )


@app.get("/app.js")
def app_js():
    return send_from_directory(
        BASE_DIR,
        "app.js",
        mimetype="application/javascript"
    )


@app.get("/favicon.ico")
def favicon():
    favicon_path = os.path.join(
        BASE_DIR,
        "favicon.ico"
    )

    if os.path.exists(favicon_path):
        return send_from_directory(
            BASE_DIR,
            "favicon.ico"
        )

    return "", 204

@app.get("/api/health")
def health():

    mongo_ok = False

    if db is not None:
        try:
            db.command("ping")
            mongo_ok = True
        except Exception:
            mongo_ok = False

    return jsonify({
        "ok": True,
        "mongodb": mongo_ok,
        "groq_configured": bool(GROQ_API_KEY),
        "groq_model": GROQ_MODEL
    })


# =========================================================
# AUTH
# =========================================================

@app.post("/api/auth/register")
def register():

    if db is None:
        return jsonify({
            "error": "MongoDB не настроена"
        }), 500

    data = request.get_json() or {}

    fields = [
        "first_name",
        "last_name",
        "birth_year",
        "position",
        "rank",
        "password"
    ]

    if any(
        not str(data.get(field, "")).strip()
        for field in fields
    ):
        return jsonify({
            "error": "Заполните все поля"
        }), 400

    try:
        year = int(
            data["birth_year"]
        )
    except Exception:
        return jsonify({
            "error": "Некорректный год рождения"
        }), 400

    if len(data["password"]) < 8:
        return jsonify({
            "error":
                "Пароль должен содержать минимум 8 символов"
        }), 400

    existing = users.find_one({
        "passport.first_name":
            data["first_name"].strip(),

        "passport.last_name":
            data["last_name"].strip(),

        "passport.birth_year":
            year
    })

    if existing:
        return jsonify({
            "error":
                "Пользователь с такими паспортными данными уже зарегистрирован"
        }), 409

    user = {

        "passport": {

            "first_name":
                data["first_name"].strip(),

            "last_name":
                data["last_name"].strip(),

            "birth_year":
                year,

            "position":
                data["position"].strip(),

            "rank":
                data["rank"].strip()
        },

        "password_hash":
            bcrypt.hashpw(
                data["password"].encode(),
                bcrypt.gensalt()
            ).decode(),

        "username":
            uuid.uuid4().hex,

        "created_at":
            datetime.now(timezone.utc),

        "settings": {
            "two_factor": False
        }
    }

    result = users.insert_one(user)

    user["_id"] = result.inserted_id

    return jsonify({
        "token": token_for(user),
        "user": jsonable(user)
    })


@app.post("/api/auth/login")
def login():

    if users is None:
        return jsonify({
            "error": "MongoDB не настроена"
        }), 500

    data = request.get_json() or {}

    first = (
        data.get("first_name", "")
        .strip()
    )

    last = (
        data.get("last_name", "")
        .strip()
    )

    password = data.get(
        "password",
        ""
    )

    user = users.find_one({
        "passport.first_name": first,
        "passport.last_name": last
    })

    if not user:
        return jsonify({
            "error":
                "Неверные данные для входа"
        }), 401

    try:

        valid = bcrypt.checkpw(
            password.encode(),
            user["password_hash"].encode()
        )

    except Exception:

        valid = False

    if not valid:
        return jsonify({
            "error":
                "Неверные данные для входа"
        }), 401

    return jsonify({
        "token": token_for(user),
        "user": jsonable(user)
    })


@app.get("/api/me")
@auth_required
def me(user):

    return jsonify({
        "user": jsonable(user)
    })


# =========================================================
# PINMAIL
# =========================================================

@app.post("/api/pinmail/create")
@auth_required
def create_pinmail(user):

    data = request.get_json() or {}

    username = clean_username(
        data.get("username")
    )

    if not username:
        return jsonify({
            "error":
                "Используйте 3–30 символов: "
                "a-z, 0-9, точка, _ или -"
        }), 400

    since = (
        datetime.now(timezone.utc)
        - timedelta(days=1)
    )

    count = mailboxes.count_documents({
        "owner_id": str(user["_id"]),
        "created_at": {
            "$gte": since
        }
    })

    if count >= 5:
        return jsonify({
            "error":
                "Лимит: 5 почтовых адресов за 24 часа"
        }), 429

    address = (
        username
        + "@pinmail.pin"
    )

    if mailboxes.find_one({
        "address": address
    }):
        return jsonify({
            "error":
                "Этот адрес уже занят"
        }), 409

    box = {

        "owner_id":
            str(user["_id"]),

        "address":
            address,

        "username":
            username,

        "created_at":
            datetime.now(timezone.utc)
    }

    result = mailboxes.insert_one(box)

    box["_id"] = result.inserted_id

    return jsonify({
        "mailbox": jsonable(box)
    })


@app.get("/api/pinmail")
@auth_required
def pinmail_list(user):

    rows = mailboxes.find({
        "owner_id":
            str(user["_id"])
    }).sort(
        "created_at",
        DESCENDING
    )

    return jsonify({
        "mailboxes":
            [
                jsonable(row)
                for row in rows
            ]
    })


@app.post("/api/pinmail/settings")
@auth_required
def pinmail_settings(user):

    data = request.get_json() or {}

    enabled = bool(
        data.get("two_factor")
    )

    users.update_one(
        {
            "_id":
                user["_id"]
        },
        {
            "$set": {
                "settings.two_factor":
                    enabled
            }
        }
    )

    return jsonify({
        "ok": True,
        "two_factor": enabled
    })


# =========================================================
# MAIL
# =========================================================

@app.get("/api/mail/<mailbox_id>")
@auth_required
def mailbox_messages(
    user,
    mailbox_id
):

    try:

        box = mailboxes.find_one({
            "_id":
                ObjectId(mailbox_id),

            "owner_id":
                str(user["_id"])
        })

    except Exception:

        return jsonify({
            "error":
                "Некорректный идентификатор почты"
        }), 400

    if not box:
        return jsonify({
            "error":
                "Почта не найдена"
        }), 404

    # Удаляем письма, чей срок хранения закончился.
    try:

        messages.delete_many({
            "delete_at": {
                "$lte":
                    datetime.now(timezone.utc)
            }
        })

    except Exception as e:

        app.logger.warning(
            "Trash cleanup error: %s",
            e
        )

    rows = messages.find({

        "owner_id":
            str(user["_id"]),

        "mailbox_id":
            mailbox_id,

        "folder": {
            "$ne":
                "trash"
        }

    }).sort(
        "created_at",
        DESCENDING
    )

    return jsonify({
        "messages":
            [
                jsonable(row)
                for row in rows
            ]
    })


@app.post("/api/mail/message")
@auth_required
def send_mail(user):

    data = request.get_json() or {}

    required = [
        "mailbox_id",
        "to",
        "subject",
        "body"
    ]

    if any(
        not str(data.get(key, "")).strip()
        for key in required
    ):
        return jsonify({
            "error":
                "Заполните поля письма"
        }), 400

    try:

        box = mailboxes.find_one({
            "_id":
                ObjectId(data["mailbox_id"]),

            "owner_id":
                str(user["_id"])
        })

    except Exception:

        return jsonify({
            "error":
                "Некорректный идентификатор почты"
        }), 400

    if not box:
        return jsonify({
            "error":
                "Почта не найдена"
        }), 404

    now = datetime.now(
        timezone.utc
    )

    doc = {

        "owner_id":
            str(user["_id"]),

        "mailbox_id":
            data["mailbox_id"],

        "from":
            box["address"],

        "to":
            data["to"].strip(),

        "subject":
            data["subject"].strip(),

        "body":
            data["body"].strip(),

        "folder":
            "sent",

        "created_at":
            now
    }

    result = messages.insert_one(doc)

    doc["_id"] = result.inserted_id

    return jsonify({
        "message":
            jsonable(doc)
    })


@app.post("/api/mail/<message_id>/trash")
@auth_required
def trash_mail(
    user,
    message_id
):

    try:

        result = messages.update_one(

            {
                "_id":
                    ObjectId(message_id),

                "owner_id":
                    str(user["_id"])
            },

            {
                "$set": {

                    "folder":
                        "trash",

                    "delete_at":
                        datetime.now(
                            timezone.utc
                        )
                        + timedelta(days=7)
                }
            }
        )

    except Exception:

        return jsonify({
            "error":
                "Некорректный идентификатор письма"
        }), 400

    return jsonify({
        "ok":
            result.modified_count == 1
    })


@app.post("/api/mail/<message_id>/restore")
@auth_required
def restore_mail(
    user,
    message_id
):

    try:

        result = messages.update_one(

            {
                "_id":
                    ObjectId(message_id),

                "owner_id":
                    str(user["_id"])
            },

            {
                "$set": {
                    "folder":
                        "inbox"
                },

                "$unset": {
                    "delete_at":
                        ""
                }
            }
        )

    except Exception:

        return jsonify({
            "error":
                "Некорректный идентификатор письма"
        }), 400

    return jsonify({
        "ok":
            result.modified_count == 1
    })


@app.delete("/api/mail/<message_id>")
@auth_required
def delete_mail(
    user,
    message_id
):

    try:

        result = messages.delete_one({
            "_id":
                ObjectId(message_id),

            "owner_id":
                str(user["_id"])
        })

    except Exception:

        return jsonify({
            "error":
                "Некорректный идентификатор письма"
        }), 400

    return jsonify({
        "ok":
            result.deleted_count == 1
    })


# =========================================================
# GROQ
# =========================================================

def groq_chat(messages_in):

    if not GROQ_API_KEY:
        raise RuntimeError(
            "GROQ_API_KEY не задан в Render"
        )

    url = (
        "https://api.groq.com/"
        "openai/v1/chat/completions"
    )

    response = requests.post(

        url,

        headers={
            "Authorization":
                f"Bearer {GROQ_API_KEY}",

            "Content-Type":
                "application/json"
        },

        json={

            "model":
                GROQ_MODEL,

            "messages":
                messages_in,

            "temperature":
                0.4,

            "max_tokens":
                2048
        },

        timeout=90
    )

    # Не используем просто raise_for_status(),
    # чтобы пользователь увидел настоящую ошибку
    # от Groq.
    if not response.ok:

        try:
            details = response.json()

        except Exception:
            details = response.text[:2000]

        raise RuntimeError(
            "Groq HTTP "
            + str(response.status_code)
            + ": "
            + str(details)
        )

    try:
        data = response.json()

    except Exception as e:

        raise RuntimeError(
            "Groq вернул некорректный JSON: "
            + str(e)
        )

    if not data.get("choices"):

        raise RuntimeError(
            "Groq вернул неожиданный ответ: "
            + str(data)[:2000]
        )

    content = (
        data["choices"][0]
        .get("message", {})
        .get("content")
    )

    if not content:

        raise RuntimeError(
            "Groq не вернул текст ответа: "
            + str(data)[:2000]
        )

    return content


# =========================================================
# AI CHAT
# =========================================================

@app.post("/api/ai/chat")
@auth_required
def ai_chat(user):

    data = request.get_json() or {}

    text = (
        data.get("message", "")
        .strip()
    )

    if not text:
        return jsonify({
            "error": "Пустое сообщение"
        }), 400

    system = """
Ты ИИ-помощник вымышленной Пинийской Федерации.

Отвечай пользователю по-русски.

Ты можешь помогать с:
- Госуслугами;
- Pinmail;
- навигацией по сайту;
- обычными вопросами;
- погодой;
- действиями внутри приложения.

НАВИГАЦИЯ

Если пользователь явно просит открыть почту,
добавь в самое начало ответа:

ACTION: OPEN_MAIL

Если пользователь явно просит открыть Госуслуги,
добавь в самое начало ответа:

ACTION: OPEN_GOV

СОЗДАНИЕ PINMAIL

Если пользователь явно просит создать новый адрес Pinmail
и указывает желаемое имя, добавь в начало ответа:

ACTION: CREATE_MAIL:username

username может содержать только:
a-z, 0-9, точку, _ или -.

Пример:

ACTION: CREATE_MAIL:alex

Готово, создаю адрес alex@pinmail.pin.

Не выполняй опасные или необратимые действия
без явного подтверждения пользователя.

Не придумывай результаты действий.
Если действие ещё не выполнено приложением,
не утверждай, что оно уже выполнено.
"""

    # Получаем последние сообщения пользователя.
    history = list(
        ai_messages.find({
            "owner_id": str(user["_id"])
        })
        .sort(
            "created_at",
            DESCENDING
        )
        .limit(12)
    )

    history.reverse()

    messages_in = [
        {
            "role": "system",
            "content": system
        }
    ]

    messages_in += [
        {
            "role": item["role"],
            "content": item["content"]
        }
        for item in history
    ]

    messages_in.append({
        "role": "user",
        "content": text
    })

    # Запрос к Groq.
    try:

        answer = groq_chat(
            messages_in
        )

    except Exception as e:

        app.logger.exception(
            "Groq request failed"
        )

        return jsonify({
            "error": str(e)
        }), 502

    # Сохраняем историю.
    now = datetime.now(
        timezone.utc
    )

    ai_messages.insert_many([

        {
            "owner_id":
                str(user["_id"]),

            "role":
                "user",

            "content":
                text,

            "created_at":
                now
        },

        {
            "owner_id":
                str(user["_id"]),

            "role":
                "assistant",

            "content":
                answer,

            "created_at":
                now + timedelta(
                    microseconds=1
                )
        }

    ])

    return jsonify({
        "answer": answer
    })


# =========================================================
# AI HISTORY
# =========================================================

@app.get("/api/ai/history")
@auth_required
def ai_history(user):

    rows = list(
        ai_messages.find({
            "owner_id":
                str(user["_id"])
        })
        .sort(
            "created_at",
            ASCENDING
        )
        .limit(200)
    )

    return jsonify({
        "messages": [
            jsonable(row)
            for row in rows
        ]
    })


# =========================================================
# WEATHER
# =========================================================

@app.get("/api/weather")
@auth_required
def weather(user):

    if not OPENWEATHER_API_KEY:
        return jsonify({
            "error": "OPENWEATHER_API_KEY не задан в Render"
        }), 500

    lat = request.args.get("lat", "").strip()
    lon = request.args.get("lon", "").strip()
    city = request.args.get("city", "").strip()

    base_params = {
        "appid": OPENWEATHER_API_KEY,
        "units": "metric",
        "lang": "ru"
    }

    # =====================================================
    # 1. КООРДИНАТЫ
    # =====================================================

    if lat and lon:

        try:
            lat_value = float(lat)
            lon_value = float(lon)

            if not -90 <= lat_value <= 90:
                raise ValueError()

            if not -180 <= lon_value <= 180:
                raise ValueError()

        except ValueError:

            return jsonify({
                "error": "Некорректные координаты"
            }), 400


        params = {
            **base_params,
            "lat": lat_value,
            "lon": lon_value
        }


    # =====================================================
    # 2. НАЗВАНИЕ ГОРОДА / МЕСТА
    # =====================================================

    elif city:

        # Сначала используем Geocoding API.
        #
        # Это позволяет:
        # Москва
        # Paris
        # Tokyo
        # New York
        # маленькие города
        # населённые пункты
        # и т.д.

        geo_params = {
            "q": city,
            "limit": 5,
            "appid": OPENWEATHER_API_KEY
        }

        try:

            geo_response = requests.get(
                "https://api.openweathermap.org/geo/1.0/direct",
                params=geo_params,
                timeout=20
            )

        except requests.RequestException as e:

            return jsonify({
                "error": "Ошибка соединения с OpenWeather Geocoding",
                "details": str(e)
            }), 502


        if not geo_response.ok:

            try:
                details = geo_response.json()
            except Exception:
                details = geo_response.text[:1000]

            return jsonify({
                "error": "Ошибка геокодирования места",
                "status": geo_response.status_code,
                "details": details
            }), geo_response.status_code


        try:

            locations = geo_response.json()

        except Exception:

            return jsonify({
                "error": "Geocoding вернул некорректный ответ"
            }), 502


        if not locations:

            return jsonify({
                "error": f"Место «{city}» не найдено"
            }), 404


        # Берём первый наиболее подходящий результат.
        location = locations[0]

        found_lat = location.get("lat")
        found_lon = location.get("lon")

        if found_lat is None or found_lon is None:

            return jsonify({
                "error": "Geocoding не вернул координаты"
            }), 502


        params = {
            **base_params,
            "lat": found_lat,
            "lon": found_lon
        }


    # =====================================================
    # 3. НИЧЕГО НЕ УКАЗАНО
    # =====================================================

    else:

        return jsonify({
            "error": "Укажите city или lat/lon"
        }), 400


    # =====================================================
    # 4. ПОЛУЧАЕМ ПОГОДУ ПО КООРДИНАТАМ
    # =====================================================

    try:

        weather_response = requests.get(
            "https://api.openweathermap.org/data/2.5/weather",
            params=params,
            timeout=20
        )

    except requests.RequestException as e:

        return jsonify({
            "error": "Ошибка соединения с OpenWeather",
            "details": str(e)
        }), 502


    if not weather_response.ok:

        try:
            details = weather_response.json()
        except Exception:
            details = weather_response.text[:1000]

        print(
            "OPENWEATHER WEATHER ERROR:",
            weather_response.status_code,
            details
        )

        return jsonify({
            "error": "OpenWeather вернул ошибку погоды",
            "status": weather_response.status_code,
            "details": details
        }), weather_response.status_code


    try:

        weather_data =
            weather_response.json()

    except Exception:

        return jsonify({
            "error": "OpenWeather вернул некорректный JSON"
        }), 502


    # =====================================================
    # 5. ДОБАВЛЯЕМ ИНФОРМАЦИЮ О НАЙДЕННОМ МЕСТЕ
    # =====================================================

    result = {
        **weather_data
    }


    result["_source"] = {
        "lat": weather_data.get(
            "coord", {}
        ).get("lat"),

        "lon": weather_data.get(
            "coord", {}
        ).get("lon"),

        "city": weather_data.get(
            "name"
        ),

        "country": weather_data.get(
            "sys", {}
        ).get("country")
    }


    return jsonify(result)

# =========================================================
# AI IMAGE GENERATION
# =========================================================

@app.post("/api/ai/image")
@auth_required
def ai_image(user):
    data = request.get_json() or {}
    prompt = str(data.get("prompt", "")).strip()

    if not prompt:
        return jsonify({"error": "Пустой prompt"}), 400

    if not CLOUDFLARE_API_TOKEN or not CLOUDFLARE_ACCOUNT_ID:
        return jsonify({
            "error": "Cloudflare AI не настроен"
        }), 500

    # 1. Переводим запрос на английский через Groq
    try:
        en_prompt = groq_chat([
            {
                "role": "system",
                "content": (
                    "Translate the user's image request into a "
                    "detailed English image generation prompt. "
                    "Return only the prompt."
                )
            },
            {
                "role": "user",
                "content": prompt
            }
        ])
    except Exception:
        en_prompt = prompt

    url = (
        f"https://api.cloudflare.com/client/v4/accounts/"
        f"{CLOUDFLARE_ACCOUNT_ID}/ai/run/"
        f"{CLOUDFLARE_IMAGE_MODEL}"
    )

    try:
        response = requests.post(
            url,
            headers={
                "Authorization":
                    f"Bearer {CLOUDFLARE_API_TOKEN}",
                "Content-Type":
                    "application/json",
                "Accept":
                    "image/png"
            },
            json={
                "prompt": en_prompt
            },
            timeout=120
        )

    except requests.RequestException as e:
        return jsonify({
            "error": "Ошибка соединения с Cloudflare",
            "details": str(e)
        }), 502

    if not response.ok:
        try:
            details = response.json()
        except Exception:
            details = response.text[:1000]

        return jsonify({
            "error": "Cloudflare image generation failed",
            "status": response.status_code,
            "details": details
        }), 502

    content_type = (
        response.headers.get(
            "Content-Type",
            "image/png"
        )
    ).lower()

    # Cloudflare вернул непосредственно картинку
    if content_type.startswith("image/"):

        encoded = base64.b64encode(
            response.content
        ).decode("ascii")

        image_url = (
            f"data:{content_type};base64,{encoded}"
        )

        return jsonify({
            "prompt": en_prompt,
            "image": image_url
        })

    # Иногда API может вернуть JSON
    try:
        body = response.json()
    except Exception:
        return jsonify({
            "error": "Cloudflare вернул неизвестный формат",
            "content_type": content_type
        }), 502

    result = body.get("result")

    if isinstance(result, dict):

        image_url = (
            result.get("image") or
            result.get("image_url") or
            result.get("url")
        )

        if image_url:
            return jsonify({
                "prompt": en_prompt,
                "image": image_url
            })

    if isinstance(result, str):
        return jsonify({
            "prompt": en_prompt,
            "image": result
        })

    return jsonify({
        "error": "Cloudflare не вернул изображение",
        "details": body
    }), 502

# =========================================================
# SITE ACTION
# =========================================================

@app.post("/api/action/create-mail")
@auth_required
def action_create_mail(user):

    return create_pinmail(user)


# =========================================================
# GLOBAL ERROR HANDLER
# =========================================================

@app.errorhandler(Exception)
def error(e):

    app.logger.exception(
        "Unhandled server error"
    )

    return jsonify({
        "error":
            "Внутренняя ошибка сервера"
    }), 500


# =========================================================
# START SERVER
# =========================================================

if __name__ == "__main__":

    app.run(
        host="0.0.0.0",

        port=int(
            os.getenv(
                "PORT",
                5000
            )
        )
    )
