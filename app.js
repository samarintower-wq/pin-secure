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

function addHTMLBubble(type, html) {
    const chat = document.querySelector("#chat");

    if (!chat) {
        console.error("Chat container #chat not found");
        return null;
    }

    const bubble = document.createElement("div");

    bubble.className =
        "bubble " +
        (type === "user" ? "user" : "ai");

    bubble.innerHTML = html;

    chat.appendChild(bubble);

    chat.scrollTop = chat.scrollHeight;

    return bubble;
}

function addBubble(type, text) {
    const chat = document.querySelector("#chat");

    if (!chat) {
        console.error("Chat container #chat not found");
        return;
    }

    const bubble = document.createElement("div");

    bubble.className =
        "bubble " +
        (type === "user" ? "user" : "ai");

    bubble.textContent = String(
        text ?? ""
    );

    chat.appendChild(bubble);

    chat.scrollTop = chat.scrollHeight;

    return bubble;
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
    const chat = document.querySelector("#chat");

    // Создаём контейнер сообщения
    const message = document.createElement("div");
    message.className = "bubble ai image-message";

    const loading = document.createElement("div");
    loading.textContent = "🎨 Генерирую изображение…";
    message.appendChild(loading);

    if (chat) {
        chat.appendChild(message);
        chat.scrollTop = chat.scrollHeight;
    }

    try {
        const token =
            localStorage.getItem("token") ||
            localStorage.getItem("pin_token");

        const headers = {
            "Content-Type": "application/json"
        };

        if (token) {
            headers["Authorization"] = "Bearer " + token;
        }

        const response = await fetch("/api/ai/image", {
            method: "POST",
            headers: headers,
            body: JSON.stringify({
                prompt: prompt
            })
        });

        let data;

        try {
            data = await response.json();
        } catch (e) {
            throw new Error(
                "Сервер вернул некорректный ответ"
            );
        }

        console.log("IMAGE RESPONSE:", data);

        if (!response.ok) {
            throw new Error(
                data.error ||
                "Ошибка генерации изображения: HTTP " +
                response.status
            );
        }

        if (!data.image) {
            throw new Error(
                "Сервер не вернул изображение"
            );
        }

        let imageSrc = data.image;

        if (typeof imageSrc !== "string") {
            throw new Error(
                "Неверный формат изображения"
            );
        }

        /*
         * Cloudflare может вернуть чистый Base64.
         * Превращаем его в полноценный Data URL.
         */
        if (
            !imageSrc.startsWith("data:image/") &&
            !imageSrc.startsWith("http://") &&
            !imageSrc.startsWith("https://")
        ) {
            imageSrc =
                "data:image/jpeg;base64," +
                imageSrc;
        }

        // Очищаем сообщение загрузки
        if (loading && loading.parentNode) {
            loading.remove();
        }

        // Создаём изображение
        const image = document.createElement("img");

        image.alt = data.prompt || prompt || "Сгенерированное изображение";

        image.style.display = "block";
        image.style.width = "100%";
        image.style.maxWidth = "700px";
        image.style.height = "auto";
        image.style.borderRadius = "16px";
        image.style.marginTop = "4px";

        image.onload = () => {
            console.log("IMAGE LOADED");

            if (chat) {
                chat.scrollTop = chat.scrollHeight;
            }
        };

        image.onerror = () => {
            console.error(
                "IMAGE LOAD ERROR",
                imageSrc.substring(0, 100)
            );

            image.remove();

            const errorText =
                document.createElement("div");

            errorText.textContent =
                "❌ Не удалось отобразить сгенерированное изображение.";

            message.appendChild(errorText);

            if (chat) {
                chat.scrollTop = chat.scrollHeight;
            }
        };

        image.src = imageSrc;

        message.appendChild(image);

        // Показываем переведённый prompt, если он пришёл
        if (data.prompt) {
            const description =
                document.createElement("div");

            description.style.marginTop = "10px";
            description.style.opacity = "0.65";
            description.style.fontSize = "12px";
            description.textContent =
                "Prompt: " + data.prompt;

            message.appendChild(description);
        }

        if (chat) {
            chat.scrollTop = chat.scrollHeight;
        }

        return data;

    } catch (error) {
        console.error("Image error:", error);

        if (loading && loading.parentNode) {
            loading.remove();
        }

        const errorText =
            document.createElement("div");

        errorText.textContent =
            "❌ Не удалось создать изображение: " +
            error.message;

        message.appendChild(errorText);

        if (chat) {
            chat.scrollTop = chat.scrollHeight;
        }

        return null;
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

async function getWeather(city = null, lat = null, lon = null) {
    try {
        let url = "/api/weather";

        if (lat !== null && lon !== null) {
            url =
                "/api/weather?lat=" +
                encodeURIComponent(lat) +
                "&lon=" +
                encodeURIComponent(lon);
        } else if (city) {
            url =
                "/api/weather?city=" +
                encodeURIComponent(city);
        } else {
            if (!navigator.geolocation) {
                throw new Error("Геолокация не поддерживается браузером");
            }

            $("#orbStatus").textContent =
                "📍 Определяю ваше местоположение…";

            const position = await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(
                    resolve,
                    reject,
                    {
                        enableHighAccuracy: true,
                        timeout: 15000,
                        maximumAge: 300000
                    }
                );
            });

            lat = position.coords.latitude;
            lon = position.coords.longitude;

            url =
                "/api/weather?lat=" +
                encodeURIComponent(lat) +
                "&lon=" +
                encodeURIComponent(lon);
        }

        const token =
            localStorage.getItem("token") ||
            localStorage.getItem("pin_token");

        const headers = {};

        if (token) {
            headers["Authorization"] = "Bearer " + token;
        }

        const response = await fetch(url, {
            method: "GET",
            headers
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data.error ||
                "Ошибка получения погоды: HTTP " + response.status
            );
        }

        console.log("WEATHER RESULT:", data);

        renderWeather(data);

        return data;

    } catch (error) {
        console.error("Weather error:", error);

        addBubble(
            "ai",
            "🌦️ Не удалось получить погоду: " + error.message
        );

        return null;
    }
}

function extractWeatherLocation(text) {
    const value = String(text || "")
        .trim()
        .replace(/[?!]/g, "");

    const patterns = [
        /(?:какая|какой)\s+(?:сейчас\s+)?погод[аыу]\s+(?:в|во|на)\s+(.+)/i,

        /(?:погода|температура|прогноз)\s+(?:сейчас\s+)?(?:в|во|на)\s+(.+)/i,

        /(?:weather|forecast)\s+(?:in|at|for)\s+(.+)/i
    ];

    for (const pattern of patterns) {
        const match = value.match(pattern);

        if (match && match[1]) {
            return match[1]
                .replace(
                    /\s+(?:сейчас|сегодня|завтра|на сегодня|на завтра).*$/i,
                    ""
                )
                .replace(/[.,]+$/, "")
                .trim();
        }
    }

    return null;
}

function extractCoordinates(text) {
    const match = text.match(
        /(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)/
    );

    if (!match) return null;

    const lat = Number(match[1]);
    const lon = Number(match[2]);

    if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lon) ||
        lat < -90 ||
        lat > 90 ||
        lon < -180 ||
        lon > 180
    ) {
        return null;
    }

    return { lat, lon };
}



async function sendAI(text = null) {
    // Если текст не передан — берём его из поля ввода
    if (typeof text !== "string") {
        const input = document.querySelector("#chatInput");
        text = input ? input.value.trim() : "";
    } else {
        text = text.trim();
    }

    if (!text) return;

    const input = document.querySelector("#chatInput");

    // Очищаем поле ввода
    if (input) {
        input.value = "";
    }

    // Показываем сообщение пользователя
    addBubble("user", text);

    const lower = text.toLowerCase();

    /*
     * =========================================================
     * ПОГОДА
     * =========================================================
     */

    if (
        /погод|температур|прогноз|weather|forecast/i.test(lower)
    ) {
        // 1. Сначала проверяем координаты
        const coordinates = extractCoordinates(text);

        if (coordinates) {
            console.log(
                "WEATHER COORDINATES:",
                coordinates
            );

            await getWeather(
                null,
                coordinates.lat,
                coordinates.lon
            );

            return;
        }

        // 2. Затем пытаемся определить название места
        const location = extractWeatherLocation(text);

        if (location) {
            console.log(
                "WEATHER LOCATION:",
                location
            );

            await getWeather(location);

            return;
        }

        // 3. Если место не указано —
        // используем GPS
        await getWeather();

        return;
    }

    /*
     * =========================================================
     * ГЕНЕРАЦИЯ ИЗОБРАЖЕНИЯ
     * =========================================================
     */

    if (
        /нарисуй|нарисовать|создай изображение|создай картинку|сгенерируй изображение|сгенерируй картинку|изобрази|draw|generate image|create image/i.test(lower)
    ) {
        await generateImage(text);
        return;
    }

    /*
     * =========================================================
     * Обычный AI-запрос
     * =========================================================
     */

    try {
        const token =
            localStorage.getItem("token") ||
            localStorage.getItem("pin_token");

        const headers = {
            "Content-Type": "application/json"
        };

        if (token) {
            headers["Authorization"] =
                "Bearer " + token;
        }

        const response = await fetch(
            "/api/ai/chat",
            {
                method: "POST",
                headers: headers,
                body: JSON.stringify({
                    message: text
                })
            }
        );

        let data;

        try {
            data = await response.json();
        } catch (e) {
            throw new Error(
                "Сервер вернул некорректный ответ"
            );
        }

        console.log(
            "AI RESPONSE:",
            data
        );

        if (!response.ok) {
            throw new Error(
                data.error ||
                "Ошибка AI: HTTP " +
                response.status
            );
        }

        if (!data.answer) {
            throw new Error(
                "AI не вернул ответ"
            );
        }

        let answer = data.answer;

        /*
         * =====================================================
         * ДЕЙСТВИЯ AI
         * =====================================================
         */

        if (answer.startsWith("ACTION:")) {
            const lines = answer.split("\n");

            const actionLine =
                lines[0].trim();

            const action =
                actionLine
                    .replace("ACTION:", "")
                    .trim();

            const visibleAnswer =
                lines
                    .slice(1)
                    .join("\n")
                    .trim();

            if (visibleAnswer) {
                addBubble(
                    "ai",
                    visibleAnswer
                );
            }

            /*
             * Открыть Pinmail
             */
            if (action === "OPEN_MAIL") {
                if (
                    typeof openPage ===
                    "function"
                ) {
                    openPage("mail");
                }

                return;
            }

            /*
             * Открыть Госуслуги
             */
            if (action === "OPEN_GOV") {
                if (
                    typeof openPage ===
                    "function"
                ) {
                    openPage("gov");
                }

                return;
            }

            /*
             * Создать Pinmail
             */
            if (
                action.startsWith(
                    "CREATE_MAIL:"
                )
            ) {
                const username =
                    action
                        .substring(
                            "CREATE_MAIL:".length
                        )
                        .trim();

                if (!username) {
                    addBubble(
                        "ai",
                        "Не удалось определить имя нового почтового адреса."
                    );

                    return;
                }

                try {
                    const createResponse =
                        await fetch(
                            "/api/action/create-mail",
                            {
                                method: "POST",
                                headers: headers,
                                body: JSON.stringify({
                                    username:
                                        username
                                })
                            }
                        );

                    const createData =
                        await createResponse.json();

                    if (
                        !createResponse.ok
                    ) {
                        throw new Error(
                            createData.error ||
                            "Не удалось создать почту"
                        );
                    }

                    addBubble(
                        "ai",
                        "✉️ Почтовый адрес создан: " +
                        createData.mailbox.address
                    );

                    if (
                        typeof openPage ===
                        "function"
                    ) {
                        openPage("mail");
                    }

                    if (
                        typeof loadMailboxes ===
                        "function"
                    ) {
                        await loadMailboxes();
                    }

                } catch (error) {
                    console.error(
                        "CREATE_MAIL:",
                        error
                    );

                    addBubble(
                        "ai",
                        "❌ Не удалось создать почтовый адрес: " +
                        error.message
                    );
                }

                return;
            }

            return;
        }

        /*
         * =====================================================
         * Обычный ответ
         * =====================================================
         */

        addBubble(
            "ai",
            answer
        );

        /*
         * Озвучивание ответа
         */
        if (
            typeof speak ===
            "function"
        ) {
            try {
                speak(answer);
            } catch (error) {
                console.warn(
                    "Speech error:",
                    error
                );
            }
        }

    } catch (error) {
        console.error(
            "AI error:",
            error
        );

        addBubble(
            "ai",
            "❌ Не удалось получить ответ: " +
            error.message
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
