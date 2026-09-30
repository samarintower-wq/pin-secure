const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

let token = localStorage.getItem("pin_token");

let state = {
    user: null,
    mailboxes: [],
    current: null
};


/* =========================================================
   API
   ========================================================= */

async function api(path, options = {}) {

    options.headers = {
        "Content-Type": "application/json",
        ...(options.headers || {})
    };

    if (token) {
        options.headers.Authorization =
            "Bearer " + token;
    }

    const response = await fetch(
        "/api" + path,
        options
    );

    const data = await response
        .json()
        .catch(() => ({}));

    if (!response.ok) {
        throw new Error(
            data.error ||
            "Произошла ошибка"
        );
    }

    return data;
}


/* =========================================================
   AUTH
   ========================================================= */

function showAuth(type) {

    $$(".tab").forEach(tab => {

        tab.classList.toggle(
            "active",
            tab.dataset.auth === type
        );

    });

    $("#loginForm").hidden =
        type !== "login";

    $("#registerForm").hidden =
        type !== "register";

    $("#authError").textContent = "";
}


$$(".tab").forEach(tab => {

    tab.onclick = () => {
        showAuth(
            tab.dataset.auth
        );
    };

});


$("#loginForm").onsubmit = async event => {

    event.preventDefault();

    try {

        const data = await api(
            "/auth/login",
            {
                method: "POST",

                body: JSON.stringify(
                    Object.fromEntries(
                        new FormData(
                            event.target
                        )
                    )
                )
            }
        );

        token = data.token;

        localStorage.setItem(
            "pin_token",
            token
        );

        await start();

    } catch (error) {

        $("#authError").textContent =
            error.message;

    }
};


$("#registerForm").onsubmit = async event => {

    event.preventDefault();

    try {

        const data = await api(
            "/auth/register",
            {
                method: "POST",

                body: JSON.stringify(
                    Object.fromEntries(
                        new FormData(
                            event.target
                        )
                    )
                )
            }
        );

        token = data.token;

        localStorage.setItem(
            "pin_token",
            token
        );

        await start();

    } catch (error) {

        $("#authError").textContent =
            error.message;

    }
};


/* =========================================================
   START
   ========================================================= */

async function start() {

    if (!token) {

        $("#auth").hidden = false;
        $("#app").hidden = true;

        return;
    }

    try {

        const data =
            await api("/me");

        state.user =
            data.user;

        $("#auth").hidden = true;
        $("#app").hidden = false;

        $("#profile").innerHTML = `
            <b>
                ${esc(
                    data.user.passport.first_name
                )}
                ${esc(
                    data.user.passport.last_name
                )}
            </b>
            <br>
            ${esc(
                data.user.passport.position
            )}
            <br>
            ${esc(
                data.user.passport.rank
            )}
        `;

        await loadMailboxes();
        await loadChat();

    } catch (error) {

        localStorage.removeItem(
            "pin_token"
        );

        token = null;

        await start();
    }
}


/* =========================================================
   NAVIGATION
   ========================================================= */

function openPage(page) {

    $$(".page").forEach(element => {

        element.classList.toggle(
            "active",
            element.id === page
        );

    });

    $$(".nav-btn").forEach(button => {

        button.classList.toggle(
            "active",
            button.dataset.page === page
        );

    });

    if (page === "mail") {
        loadMailboxes();
    }
}


$$(".nav-btn").forEach(button => {

    button.onclick = () => {

        openPage(
            button.dataset.page
        );

    };

});


$("#logout").onclick = () => {

    localStorage.removeItem(
        "pin_token"
    );

    token = null;

    location.reload();
};


/* =========================================================
   PINMAIL
   ========================================================= */

async function loadMailboxes() {

    try {

        const data =
            await api("/pinmail");

        state.mailboxes =
            data.mailboxes;

        if (!state.mailboxes.length) {

            $("#mailboxes").innerHTML = `
                <div class="card">
                    <h3>
                        У вас пока нет Pinmail
                    </h3>

                    <p class="muted">
                        Создайте первый адрес
                        электронной почты
                        @pinmail.pin
                    </p>
                </div>
            `;

            return;
        }

        $("#mailboxes").innerHTML =
            state.mailboxes
                .map(mailbox => {

                    const selected =
                        state.current &&
                        state.current._id ===
                            mailbox._id
                            ? "selected"
                            : "";

                    return `
                        <div
                            class="mailbox ${selected}"
                            onclick="selectMailbox('${mailbox._id}')"
                        >
                            <b>
                                ${esc(
                                    mailbox.address
                                )}
                            </b>

                            <br>

                            <span class="muted">
                                Pinmail
                            </span>
                        </div>
                    `;

                })
                .join("");

    } catch (error) {

        console.error(error);

    }
}


$("#newMail").onclick = async () => {

    const username =
        prompt(
            "Введите желаемый адрес без @pinmail.pin:"
        );

    if (!username) {
        return;
    }

    try {

        await api(
            "/pinmail/create",
            {
                method: "POST",

                body: JSON.stringify({
                    username
                })
            }
        );

        await loadMailboxes();

    } catch (error) {

        alert(
            error.message
        );

    }
};


async function selectMailbox(id) {

    state.current =
        state.mailboxes.find(
            mailbox =>
                mailbox._id === id
        );

    if (!state.current) {
        return;
    }

    $("#mailView").hidden =
        false;

    $("#currentAddress")
        .textContent =
        state.current.address;

    await loadMessages();
    await loadMailboxes();
}


async function loadMessages() {

    if (!state.current) {
        return;
    }

    try {

        const data =
            await api(
                "/mail/" +
                state.current._id
            );

        if (!data.messages.length) {

            $("#messages").innerHTML = `
                <p class="muted">
                    Входящих сообщений пока нет.
                </p>
            `;

            return;
        }

        $("#messages").innerHTML =
            data.messages
                .map(message => {

                    return `
                        <div class="message">

                            <b>
                                ${esc(
                                    message.subject
                                )}
                            </b>

                            <br>

                            <small>
                                ${esc(
                                    message.from || ""
                                )}
                            </small>

                            <p>
                                ${esc(
                                    message.body
                                )}
                            </p>

                        </div>
                    `;

                })
                .join("");

    } catch (error) {

        console.error(error);

    }
}


$("#compose").onclick = async () => {

    if (!state.current) {
        return;
    }

    const to =
        prompt("Кому?");

    if (!to) {
        return;
    }

    const subject =
        prompt("Тема письма") || "";

    const body =
        prompt("Сообщение") || "";

    try {

        await api(
            "/mail/message",
            {
                method: "POST",

                body: JSON.stringify({

                    mailbox_id:
                        state.current._id,

                    to,
                    subject,
                    body

                })
            }
        );

        await loadMessages();

    } catch (error) {

        alert(
            error.message
        );

    }
};


/* =========================================================
   CHAT UI
   ========================================================= */

function addBubble(
    text,
    type
) {

    $("#chat").insertAdjacentHTML(
        "beforeend",

        `
        <div class="bubble ${type}">
            ${esc(text)}
        </div>
        `
    );

    $("#chat").scrollTop =
        $("#chat").scrollHeight;
}


function addHTMLBubble(
    html
) {

    $("#chat").insertAdjacentHTML(
        "beforeend",

        `
        <div class="bubble ai">
            ${html}
        </div>
        `
    );

    $("#chat").scrollTop =
        $("#chat").scrollHeight;
}


/* =========================================================
   TEXT TO SPEECH
   ========================================================= */

function speak(text) {

    if (
        !("speechSynthesis" in window)
    ) {
        return;
    }

    try {

        window.speechSynthesis.cancel();

        const clean = String(text)
            .replace(
                /ACTION:\s*[A-Z_:-]+/gi,
                ""
            )
            .trim();

        if (!clean) {
            return;
        }

        const utterance =
            new SpeechSynthesisUtterance(
                clean
            );

        utterance.lang =
            "ru-RU";

        utterance.rate =
            1;

        utterance.pitch =
            1;

        window.speechSynthesis
            .speak(utterance);

    } catch (error) {

        console.error(
            "TTS error:",
            error
        );

    }
}


/* =========================================================
   DETECTION: IMAGE
   ========================================================= */

function isImageRequest(text) {

    const value =
        text.toLowerCase();

    const patterns = [

        /создай\s+(?:мне\s+)?изображени/i,
        /сгенерируй\s+(?:мне\s+)?изображени/i,
        /нарисуй/i,
        /сгенерируй\s+картин/i,
        /создай\s+картин/i,
        /сделай\s+картин/i,
        /изобрази/i,
        /покажи\s+изображени/i,
        /создай\s+арт/i,
        /сгенерируй\s+арт/i,
        /generate\s+(?:an?\s+)?image/i,
        /create\s+(?:an?\s+)?image/i,
        /draw\s+/i
    ];

    return patterns.some(
        pattern =>
            pattern.test(value)
    );
}

/* =========================================================
   IMAGE GENERATION
   ========================================================= */

async function generateImage(prompt) {

    addBubble(
        "user",
        prompt
    );


    const loading =
        addBubble(
            "ai",
            "🎨 Создаю изображение…"
        );


    try {

        const token =
            localStorage.getItem("token") ||
            localStorage.getItem("pin_token");


        const headers = {
            "Content-Type":
                "application/json"
        };


        if (token) {

            headers["Authorization"] =
                "Bearer " + token;
        }


        const response =
            await fetch(
                "/api/ai/image",
                {
                    method: "POST",

                    headers: headers,

                    body: JSON.stringify({
                        prompt: prompt
                    })
                }
            );


        const data =
            await response.json();


        console.log(
            "IMAGE RESPONSE:",
            data
        );


        if (!response.ok) {

            throw new Error(
                data.error ||
                "Ошибка генерации изображения"
            );
        }


        if (!data.image) {

            throw new Error(
                "Сервер не вернул изображение"
            );
        }


        loading.remove();


        /*
         * Создаём сообщение
         */

        const bubble =
            document.createElement("div");

        bubble.className =
            "bubble ai";


        /*
         * Само изображение
         */

        const image =
            document.createElement("img");


        image.alt =
            prompt;


        image.style.display =
            "block";

        image.style.width =
            "100%";

        image.style.maxWidth =
            "700px";

        image.style.height =
            "auto";

        image.style.borderRadius =
            "18px";

        image.style.objectFit =
            "contain";

        image.style.background =
            "#f0f3f8";


        /*
         * ВАЖНО:
         *
         * data.image может быть:
         *
         * data:image/png;base64,...
         *
         * или обычным URL.
         */

        image.src =
            data.image;


        /*
         * Если картинка реально загрузилась
         */

        image.onload = () => {

            console.log(
                "IMAGE LOADED"
            );
        };


        /*
         * Если браузер не смог
         * отобразить результат
         */

        image.onerror = () => {

            console.error(
                "IMAGE LOAD ERROR",
                data.image
                    ? data.image.substring(
                        0,
                        100
                    )
                    : null
            );


            bubble.innerHTML = "";

            const errorText =
                document.createElement(
                    "div"
                );

            errorText.textContent =
                "❌ Изображение получено, но браузер не смог его отобразить.";

            bubble.appendChild(
                errorText
            );
        };


        bubble.appendChild(
            image
        );


        /*
         * Добавляем в чат
         */

        $("#chat")
            .appendChild(
                bubble
            );


        $("#chat").scrollTop =
            $("#chat").scrollHeight;


    } catch (error) {

        console.error(
            "Image error:",
            error
        );


        loading.textContent =
            "❌ " +
            error.message;
    }
}

/* =========================================================
   DETECTION: WEATHER
   ========================================================= */

function isWeatherRequest(text) {

    const value =
        text.toLowerCase();

    const patterns = [

        /погод/i,
        /температур/i,
        /дожд/i,
        /снег/i,
        /ветер/i,
        /облачн/i,
        /ясно\s+сейчас/i,
        /что\s+сейчас\s+на\s+улиц/i,
        /weather/i,
        /temperature/i,
        /rain/i,
        /snow/i

    ];

    return patterns.some(
        pattern =>
            pattern.test(value)
    );
}


/* =========================================================
   WEATHER CITY EXTRACTION
   ========================================================= */

function extractWeatherCity(text) {

    const patterns = [

        /погод[а-яё]*\s+(?:в|для)\s+(.+)/i,

        /температур[а-яё]*\s+(?:в|для)\s+(.+)/i,

        /погод[а-яё]*\s+([А-ЯЁA-Z][^,.!?]+)/i,

        /weather\s+(?:in|for)\s+(.+)/i,

        /temperature\s+(?:in|for)\s+(.+)/i

    ];

    for (
        const pattern of patterns
    ) {

        const match =
            text.match(pattern);

        if (match && match[1]) {

            return match[1]
                .trim()
                .replace(
                    /[.!?]+$/,
                    ""
                );

        }

    }

    return null;
}


/* =========================================================
   WEATHER BY GEOLOCATION
   ========================================================= */

function getCurrentPosition() {

    return new Promise(
        (resolve, reject) => {

            if (
                !navigator.geolocation
            ) {

                reject(
                    new Error(
                        "Геолокация не поддерживается браузером"
                    )
                );

                return;
            }

            navigator.geolocation.getCurrentPosition(

                position => {

                    resolve({
                        lat:
                            position.coords.latitude,

                        lon:
                            position.coords.longitude
                    });

                },

                error => {

                    let message =
                        "Не удалось определить местоположение";

                    if (
                        error.code ===
                        error.PERMISSION_DENIED
                    ) {

                        message =
                            "Доступ к геолокации запрещён. " +
                            "Разрешите геолокацию или укажите город.";

                    }

                    reject(
                        new Error(message)
                    );

                },

                {
                    enableHighAccuracy:
                        false,

                    timeout:
                        10000,

                    maximumAge:
                        300000
                }
            );

        }
    );
}


/* =========================================================
   WEATHER ICON
   ========================================================= */

function weatherIcon(
    weather
) {

    const main =
        String(
            weather?.weather?.[0]?.main ||
            ""
        ).toLowerCase();

    if (
        main.includes("thunder")
    ) {
        return "⛈️";
    }

    if (
        main.includes("rain")
    ) {
        return "🌧️";
    }

    if (
        main.includes("drizzle")
    ) {
        return "🌦️";
    }

    if (
        main.includes("snow")
    ) {
        return "❄️";
    }

    if (
        main.includes("cloud")
    ) {
        return "☁️";
    }

    if (
        main.includes("mist") ||
        main.includes("fog") ||
        main.includes("haze")
    ) {
        return "🌫️";
    }

    return "☀️";
}


/* =========================================================
   WEATHER CARD
   ========================================================= */

function renderWeather(weather) {

    const city =
        weather?.name ||
        "Текущая точка";

    const country =
        weather?.sys?.country ||
        "";

    const temperature =
        Math.round(
            Number(
                weather?.main?.temp ?? 0
            )
        );

    const feels =
        Math.round(
            Number(
                weather?.main?.feels_like ?? 0
            )
        );

    const description =
        weather?.weather?.[0]?.description ||
        "Нет данных";

    const humidity =
        weather?.main?.humidity;

    const wind =
        weather?.wind?.speed;

    const pressure =
        weather?.main?.pressure;

    const visibility =
        weather?.visibility;

    const icon =
        weatherIcon(weather);

    const visibilityKm =
        visibility !== undefined
            ? (
                Number(visibility) / 1000
            ).toFixed(1)
            : null;

    addHTMLBubble(`

        <div class="weather-card">

            <div style="
                display:flex;
                align-items:center;
                gap:16px;
                margin-bottom:16px;
            ">

                <div style="
                    font-size:58px;
                    line-height:1;
                ">
                    ${icon}
                </div>

                <div>

                    <h3 style="
                        margin:0;
                        font-size:20px;
                    ">
                        ${esc(city)}
                        ${
                            country
                                ? ", " +
                                  esc(country)
                                : ""
                        }
                    </h3>

                    <div
                        class="weather-temperature"
                        style="
                            margin-top:8px;
                        "
                    >
                        ${temperature}°C
                    </div>

                </div>

            </div>

            <p style="
                font-size:16px;
                text-transform:capitalize;
            ">
                ${esc(description)}
            </p>

            <div style="
                display:grid;
                grid-template-columns:
                    repeat(
                        auto-fit,
                        minmax(130px, 1fr)
                    );
                gap:10px;
                margin-top:14px;
            ">

                <div style="
                    background:#fff;
                    border-radius:12px;
                    padding:12px;
                ">
                    <small class="muted">
                        Ощущается
                    </small>

                    <br>

                    <b>
                        ${feels}°C
                    </b>
                </div>

                ${
                    humidity !== undefined
                        ? `
                            <div style="
                                background:#fff;
                                border-radius:12px;
                                padding:12px;
                            ">
                                <small class="muted">
                                    Влажность
                                </small>

                                <br>

                                <b>
                                    ${humidity}%
                                </b>
                            </div>
                          `
                        : ""
                }

                ${
                    wind !== undefined
                        ? `
                            <div style="
                                background:#fff;
                                border-radius:12px;
                                padding:12px;
                            ">
                                <small class="muted">
                                    Ветер
                                </small>

                                <br>

                                <b>
                                    ${wind} м/с
                                </b>
                            </div>
                          `
                        : ""
                }

                ${
                    pressure !== undefined
                        ? `
                            <div style="
                                background:#fff;
                                border-radius:12px;
                                padding:12px;
                            ">
                                <small class="muted">
                                    Давление
                                </small>

                                <br>

                                <b>
                                    ${pressure} гПа
                                </b>
                            </div>
                          `
                        : ""
                }

                ${
                    visibilityKm !== null
                        ? `
                            <div style="
                                background:#fff;
                                border-radius:12px;
                                padding:12px;
                            ">
                                <small class="muted">
                                    Видимость
                                </small>

                                <br>

                                <b>
                                    ${visibilityKm} км
                                </b>
                            </div>
                          `
                        : ""
                }

            </div>

        </div>

    `);
}


/* =========================================================
   WEATHER REQUEST
   ========================================================= */

@app.get("/api/weather")
@auth_required
def weather(user):
    if not OPENWEATHER_API_KEY:
        return jsonify({"error": "OPENWEATHER_API_KEY не задан"}), 500

    lat = request.args.get("lat")
    lon = request.args.get("lon")
    place = (request.args.get("city") or request.args.get("place") or "").strip()

    # 1. Если уже есть координаты — сразу получаем погоду
    if lat and lon:
        try:
            lat_f = float(lat)
            lon_f = float(lon)

            if not (-90 <= lat_f <= 90 and -180 <= lon_f <= 180):
                return jsonify({"error": "Некорректные координаты"}), 400

        except ValueError:
            return jsonify({"error": "Координаты должны быть числами"}), 400

    # 2. Если передано название места — ищем координаты
    elif place:
        lat_f = None
        lon_f = None

        # Сначала OpenWeather Geocoding
        try:
            geo = requests.get(
                "https://api.openweathermap.org/geo/1.0/direct",
                params={
                    "q": place,
                    "limit": 5,
                    "appid": OPENWEATHER_API_KEY
                },
                timeout=15
            )

            if geo.ok:
                results = geo.json()

                if results:
                    # Берём наиболее подходящий результат
                    best = results[0]
                    lat_f = float(best["lat"])
                    lon_f = float(best["lon"])

                    found_name = best.get("name", place)
                    country = best.get("country", "")
                    state = best.get("state", "")

        except Exception as e:
            app.logger.warning("OpenWeather geocoding error: %s", e)

        # 3. Если OpenWeather не нашёл — резервный Nominatim
        if lat_f is None or lon_f is None:
            try:
                geo = requests.get(
                    "https://nominatim.openstreetmap.org/search",
                    params={
                        "q": place,
                        "format": "jsonv2",
                        "limit": 1
                    },
                    headers={
                        "User-Agent": "PinianFederationWeather/1.0"
                    },
                    timeout=15
                )

                if geo.ok:
                    results = geo.json()

                    if results:
                        lat_f = float(results[0]["lat"])
                        lon_f = float(results[0]["lon"])

            except Exception as e:
                app.logger.warning("Nominatim geocoding error: %s", e)

        if lat_f is None or lon_f is None:
            return jsonify({
                "error": f"Место «{place}» не найдено"
            }), 404

        lat = str(lat_f)
        lon = str(lon_f)

    else:
        return jsonify({
            "error": "Укажите название места или координаты"
        }), 400

    # 4. Получаем фактическую погоду именно по координатам
    try:
        weather_response = requests.get(
            "https://api.openweathermap.org/data/2.5/weather",
            params={
                "lat": lat,
                "lon": lon,
                "appid": OPENWEATHER_API_KEY,
                "units": "metric",
                "lang": "ru"
            },
            timeout=20
        )
    except Exception as e:
        app.logger.exception(e)
        return jsonify({
            "error": "Ошибка соединения с сервисом погоды"
        }), 502

    if not weather_response.ok:
        return jsonify({
            "error": "OpenWeather не смог получить погоду",
            "details": weather_response.text[:500]
        }), weather_response.status_code

    weather_data = weather_response.json()

    # Добавляем информацию о точке
    weather_data["_source"] = {
        "lat": float(lat),
        "lon": float(lon),
        "requested_place": place or None
    }

    return jsonify(weather_data)

/* =========================================================
   NORMAL AI
   ========================================================= */

async function sendAI(text) {

    text =
        String(text || "")
            .trim();

    if (!text) {
        return;
    }

    /*
     * Сначала проверяем запрос изображения.
     */

    if (
        isImageRequest(text)
    ) {

        await generateImage(
            text
        );

        return;
    }

    /*
     * Затем проверяем запрос погоды.
     */

    if (
        isWeatherRequest(text)
    ) {

        await getWeather(
            text
        );

        return;
    }

    /*
     * Всё остальное отправляем Groq.
     */

    addBubble(
        text,
        "user"
    );

    $("#chatInput").value = "";

    addHTMLBubble(`
        <div class="loading">
            ИИ думает…
        </div>
    `);

    const loadingBubble =
        $("#chat")
            .querySelector(
                ".bubble:last-child"
            );

    try {

        const data =
            await api(
                "/ai/chat",
                {
                    method: "POST",

                    body: JSON.stringify({
                        message: text
                    })
                }
            );

        if (loadingBubble) {
            loadingBubble.remove();
        }

        const answer =
            data.answer ||
            "ИИ не вернул ответ.";

        addBubble(
            answer,
            "ai"
        );

        handleAction(
            answer
        );

        speak(
            answer
        );

    } catch (error) {

        if (loadingBubble) {
            loadingBubble.remove();
        }

        addBubble(
            "Ошибка: " +
            error.message,
            "ai"
        );

    }
}


/* =========================================================
   CHAT INPUT
   ========================================================= */

$("#send").onclick = () => {

    sendAI(
        $("#chatInput")
            .value
            .trim()
    );

};


$("#chatInput").onkeydown = event => {

    if (
        event.key === "Enter" &&
        !event.shiftKey
    ) {

        event.preventDefault();

        $("#send").click();

    }

};


/* =========================================================
   AI SITE ACTIONS
   ========================================================= */

function handleAction(answer) {

    const action =
        answer.match(
            /ACTION:\s*(OPEN_MAIL|OPEN_GOV|CREATE_MAIL:([a-z0-9._-]+))/i
        );

    if (!action) {
        return;
    }

    const command =
        action[1].toUpperCase();

    /*
     * Открыть Pinmail.
     */

    if (
        command === "OPEN_MAIL"
    ) {

        openPage(
            "mail"
        );

        return;
    }

    /*
     * Открыть Госуслуги.
     */

    if (
        command === "OPEN_GOV"
    ) {

        openPage(
            "gov"
        );

        return;
    }

    /*
     * Создать Pinmail.
     */

    if (
        action[2]
    ) {

        api(
            "/pinmail/create",
            {
                method: "POST",

                body: JSON.stringify({
                    username:
                        action[2]
                })
            }
        )
        .then(() => {

            openPage(
                "mail"
            );

            loadMailboxes();

            speak(
                "Почтовый адрес создан."
            );

        })
        .catch(error => {

            addBubble(
                "Ошибка создания почты: " +
                error.message,
                "ai"
            );

        });

    }
}


/* =========================================================
   AI HISTORY
   ========================================================= */

async function loadChat() {

    try {

        const data =
            await api(
                "/ai/history"
            );

        $("#chat").innerHTML =
            "";

        data.messages.forEach(
            message => {

                addBubble(
                    message.content,
                    message.role === "user"
                        ? "user"
                        : "ai"
                );

            }
        );

    } catch (error) {

        console.error(
            "AI history:",
            error
        );

    }
}


/* =========================================================
   VOICE RECOGNITION
   ========================================================= */

let recognition = null;

let recognitionRunning =
    false;

let finalTranscript =
    "";

let lastTranscript =
    "";

let voiceSession =
    false;


/* =========================================================
   MICROPHONE / AUDIO
   ========================================================= */

let audioContext = null;

let analyser = null;

let microphoneSource = null;

let audioStream = null;

let volumeAnimation = null;


async function requestMicrophone() {

    if (
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia
    ) {

        throw new Error(
            "Микрофон не поддерживается этим браузером"
        );

    }

    if (audioStream) {
        return audioStream;
    }

    audioStream =
        await navigator.mediaDevices
            .getUserMedia({
                audio: true
            });

    return audioStream;
}


async function startAudioVisualizer() {

    try {

        const stream =
            await requestMicrophone();

        if (!audioContext) {

            audioContext =
                new (
                    window.AudioContext ||
                    window.webkitAudioContext
                )();

        }

        if (
            audioContext.state ===
            "suspended"
        ) {

            await audioContext.resume();

        }

        if (!analyser) {

            analyser =
                audioContext
                    .createAnalyser();

            analyser.fftSize =
                256;

            analyser.smoothingTimeConstant =
                0.75;

        }

        if (!microphoneSource) {

            microphoneSource =
                audioContext
                    .createMediaStreamSource(
                        stream
                    );

            microphoneSource.connect(
                analyser
            );

        }

        const data =
            new Uint8Array(
                analyser.fftSize
            );

        const animate = () => {

            if (!voiceSession) {

                volumeAnimation =
                    null;

                return;
            }

            analyser.getByteTimeDomainData(
                data
            );

            let sum = 0;

            for (
                let i = 0;
                i < data.length;
                i++
            ) {

                const value =
                    (
                        data[i] -
                        128
                    ) / 128;

                sum +=
                    value * value;
            }

            const rms =
                Math.sqrt(
                    sum /
                    data.length
                );

            const intensity =
                Math.min(
                    1,
                    rms * 5
                );

            const scale =
                1 +
                intensity * 0.20;

            const glow =
                70 +
                intensity * 90;

            $("#orb").style.transform =
                `scale(${scale})`;

            $("#orb").style.boxShadow =
                `
                0 0 0 ${
                    14 +
                    intensity * 20
                }px #2563eb18,
                0 0 ${glow}px #2563eb77
                `;

            volumeAnimation =
                requestAnimationFrame(
                    animate
                );
        };

        animate();

    } catch (error) {

        console.error(
            "Audio visualizer:",
            error
        );

    }
}


function stopAudioOnly() {

    voiceSession =
        false;

    if (volumeAnimation) {

        cancelAnimationFrame(
            volumeAnimation
        );

        volumeAnimation =
            null;
    }

    if ($("#orb")) {

        $("#orb").style.transform =
            "";

        $("#orb").style.boxShadow =
            "";

        $("#orb")
            .classList
            .remove(
                "listening"
            );

        $("#orb")
            .classList
            .remove(
                "voice-active"
            );
    }
}


/* =========================================================
   SPEECH RECOGNITION
   ========================================================= */

function createRecognition() {

    if (
        !("webkitSpeechRecognition" in window) &&
        !("SpeechRecognition" in window)
    ) {
        return null;
    }

    const Recognition =
        window.SpeechRecognition ||
        window.webkitSpeechRecognition;

    const instance =
        new Recognition();

    instance.lang = "ru-RU";

    instance.continuous = true;

    instance.interimResults = true;

    instance.maxAlternatives = 1;


    /* =====================================================
       НАЧАЛО РАСПОЗНАВАНИЯ
       ===================================================== */

    instance.onstart = () => {

        recognitionRunning = true;

        voiceSession = true;

        finalTranscript = "";

        lastTranscript = "";

        $("#orb")
            .classList
            .add("listening");

        $("#orb")
            .classList
            .add("voice-active");

        $("#orbStatus")
            .textContent =
            "Слушаю… говорите";

        startAudioVisualizer();
    };


    /* =====================================================
       РАСПОЗНАВАНИЕ РЕЧИ
       ===================================================== */

    instance.onresult = event => {

        let interim = "";

        let finalText = "";

        for (
            let i = event.resultIndex;
            i < event.results.length;
            i++
        ) {

            const result =
                event.results[i];

            const transcript =
                result[0]
                    .transcript
                    .trim();

            if (result.isFinal) {

                finalText +=
                    transcript + " ";

            } else {

                interim +=
                    transcript + " ";
            }
        }


        /*
         * Финальный распознанный текст.
         */

        if (finalText.trim()) {

            finalTranscript +=
                finalText.trim() + " ";

            lastTranscript =
                finalTranscript.trim();
        }


        /*
         * Показываем пользователю
         * то, что он сейчас говорит.
         */

        const shown =
            (
                finalTranscript +
                interim
            ).trim();

        if (shown) {

            $("#orbStatus")
                .textContent =
                shown;
        }
    };


    /* =====================================================
       ОШИБКИ
       ===================================================== */

    instance.onerror = event => {

        console.error(
            "Speech recognition error:",
            event.error
        );


        if (
            event.error ===
            "not-allowed"
        ) {

            $("#orbStatus")
                .textContent =
                "Разрешите доступ к микрофону";

        } else if (
            event.error ===
            "no-speech"
        ) {

            $("#orbStatus")
                .textContent =
                "Речь не обнаружена";

        } else if (
            event.error ===
            "network"
        ) {

            $("#orbStatus")
                .textContent =
                "Ошибка сети распознавания речи";

        } else if (
            event.error ===
            "audio-capture"
        ) {

            $("#orbStatus")
                .textContent =
                "Микрофон недоступен";

        } else {

            $("#orbStatus")
                .textContent =
                "Ошибка распознавания речи";
        }
    };


    /* =====================================================
       ОКОНЧАНИЕ РАСПОЗНАВАНИЯ
       ===================================================== */

    instance.onend = () => {

        recognitionRunning = false;


        const text =
            (
                finalTranscript ||
                lastTranscript
            ).trim();


        finalTranscript = "";

        lastTranscript = "";


        stopAudioOnly();


        $("#orbStatus")
            .textContent =
            "Нажмите на шар и говорите";


        /*
         * Если пользователь что-то сказал,
         * отправляем это в sendAI().
         *
         * sendAI() уже умеет определять:
         *
         * обычный запрос
         * запрос изображения
         * запрос погоды
         */

        if (text) {

            sendAI(text);
        }
    };


    return instance;
}


/* =========================================================
   СОЗДАНИЕ РАСПОЗНАВАТЕЛЯ
   ========================================================= */

recognition =
    createRecognition();


/* =========================================================
   ЗАПУСК ГОЛОСОВОГО РЕЖИМА
   ========================================================= */

async function startVoice() {

    if (!recognition) {

        $("#orbStatus")
            .textContent =
            "Голосовой ввод не поддерживается этим браузером";

        return;
    }


    try {

        /*
         * Запрашиваем доступ к микрофону.
         */

        await requestMicrophone();


        /*
         * Возобновляем AudioContext,
         * если браузер его приостановил.
         */

        if (
            audioContext &&
            audioContext.state ===
                "suspended"
        ) {

            await audioContext.resume();
        }


        finalTranscript = "";

        lastTranscript = "";

        voiceSession = true;


        /*
         * Запускаем распознавание.
         */

        recognition.start();


    } catch (error) {

        console.error(
            "Voice start error:",
            error
        );

        $("#orbStatus")
            .textContent =
            "Не удалось включить микрофон";
    }
}


/* =========================================================
   ОСТАНОВКА ГОЛОСОВОГО РЕЖИМА
   ========================================================= */

function stopVoice() {

    if (
        recognition &&
        recognitionRunning
    ) {

        try {

            recognition.stop();

        } catch (error) {

            console.error(
                "Voice stop error:",
                error
            );
        }
    }


    voiceSession = false;


    stopAudioOnly();


    $("#orbStatus")
        .textContent =
        "Нажмите на шар и говорите";
}


/* =========================================================
   КНОПКА ИИ-ШАРА
   ========================================================= */

$("#orb").onclick =
    async () => {

        /*
         * Если шар уже слушает —
         * второе нажатие завершает запись.
         */

        if (recognitionRunning) {

            stopVoice();

            return;
        }


        /*
         * Если не слушает —
         * начинаем запись.
         */

        await startVoice();
    };


/* =========================================================
   ОСТАНОВКА ПРИ УХОДЕ СО СТРАНИЦЫ
   ========================================================= */

document.addEventListener(
    "visibilitychange",
    () => {

        if (
            document.hidden &&
            recognitionRunning
        ) {

            stopVoice();
        }
    }
);


/* =========================================================
   ЗАЩИТА HTML
   ========================================================= */

function esc(value) {

    return String(
        value ?? ""
    ).replace(
        /[&<>"']/g,
        character => {

            const map = {

                "&":
                    "&amp;",

                "<":
                    "&lt;",

                ">":
                    "&gt;",

                '"':
                    "&quot;",

                "'":
                    "&#039;"
            };

            return map[character];
        }
    );
}


/* =========================================================
   ЗАЩИТА HTML-АТРИБУТОВ
   ========================================================= */

function escAttribute(value) {

    return String(
        value ?? ""
    )
    .replace(
        /&/g,
        "&amp;"
    )
    .replace(
        /"/g,
        "&quot;"
    )
    .replace(
        /</g,
        "&lt;"
    )
    .replace(
        />/g,
        "&gt;"
    );
}


/* =========================================================
   ЗАПУСК ПРИ ЗАГРУЗКЕ
   ========================================================= */

start();
