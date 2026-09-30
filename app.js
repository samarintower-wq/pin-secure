const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

let token = localStorage.getItem("pin_token");

const state = {
    user: null,
    mailboxes: [],
    current: null
};

let recognition = null;
let recognitionRunning = false;

let audioContext = null;
let analyser = null;
let microphoneSource = null;
let audioStream = null;
let volumeAnimation = null;
let silenceTimer = null;

let voiceSession = false;
let finalTranscript = "";
let lastTranscript = "";


/* =========================================================
   API
========================================================= */

async function api(path, options = {}) {
    const headers = {
        ...(options.headers || {})
    };

    if (options.body && !headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
    }

    if (token) {
        headers.Authorization = "Bearer " + token;
    }

    const response = await fetch("/api" + path, {
        ...options,
        headers
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(
            data.error ||
            `Ошибка сервера: ${response.status}`
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

    $("#loginForm").hidden = type !== "login";
    $("#registerForm").hidden = type !== "register";
    $("#authError").textContent = "";
}


$$(".tab").forEach(tab => {
    tab.onclick = () => {
        showAuth(tab.dataset.auth);
    };
});


$("#loginForm").onsubmit = async event => {
    event.preventDefault();

    $("#authError").textContent = "Выполняется вход…";

    try {
        const data = await api("/auth/login", {
            method: "POST",
            body: JSON.stringify(
                Object.fromEntries(
                    new FormData(event.target)
                )
            )
        });

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

    $("#authError").textContent =
        "Создание аккаунта…";

    try {
        const data = await api("/auth/register", {
            method: "POST",
            body: JSON.stringify(
                Object.fromEntries(
                    new FormData(event.target)
                )
            )
        });

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
   APPLICATION START
========================================================= */

async function start() {

    if (!token) {
        $("#auth").hidden = false;
        $("#app").hidden = true;
        return;
    }

    try {

        const data = await api("/me");

        state.user = data.user;

        $("#auth").hidden = true;
        $("#app").hidden = false;

        const passport =
            data.user.passport || {};

        $("#profile").innerHTML = `
            <b>
                ${esc(passport.first_name)}
                ${esc(passport.last_name)}
            </b>
            <br>
            ${esc(passport.position)}
            <br>
            ${esc(passport.rank)}
        `;

        await loadMailboxes();
        await loadChat();

    } catch (error) {

        console.error(error);

        localStorage.removeItem(
            "pin_token"
        );

        token = null;

        $("#auth").hidden = false;
        $("#app").hidden = true;
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
        openPage(button.dataset.page);
    };
});


/* =========================================================
   LOGOUT
========================================================= */

$("#logout").onclick = () => {

    stopVoice();

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
            data.mailboxes || [];

        if (!state.mailboxes.length) {

            $("#mailboxes").innerHTML = `
                <div class="card">
                    <h3>У вас пока нет Pinmail</h3>

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
                        state.current._id === mailbox._id
                            ? "selected"
                            : "";

                    return `
                        <div
                            class="mailbox ${selected}"
                            onclick="selectMailbox('${escAttr(mailbox._id)}')"
                        >
                            <b>
                                ${esc(mailbox.address)}
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

        console.error(
            "Pinmail error:",
            error
        );
    }
}


$("#newMail").onclick = async () => {

    const username = prompt(
        "Введите желаемый адрес без @pinmail.pin:"
    );

    if (!username) {
        return;
    }

    try {

        await api("/pinmail/create", {
            method: "POST",
            body: JSON.stringify({
                username
            })
        });

        await loadMailboxes();

    } catch (error) {

        alert(error.message);
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

    $("#mailView").hidden = false;

    $("#currentAddress").textContent =
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

        const messages =
            data.messages || [];

        if (!messages.length) {

            $("#messages").innerHTML = `
                <p class="muted">
                    Входящих сообщений пока нет.
                </p>
            `;

            return;
        }

        $("#messages").innerHTML =
            messages
                .map(message => {

                    return `
                        <div class="message">

                            <b>
                                ${esc(message.subject)}
                            </b>

                            <br>

                            <small>
                                ${esc(message.from || "")}
                            </small>

                            <p>
                                ${esc(message.body)}
                            </p>

                        </div>
                    `;
                })
                .join("");

    } catch (error) {

        console.error(
            "Mail loading error:",
            error
        );
    }
}


/* =========================================================
   SEND MAIL
========================================================= */

$("#compose").onclick = async () => {

    if (!state.current) {
        alert("Сначала выберите почтовый ящик.");
        return;
    }

    const to = prompt("Кому?");

    if (!to) {
        return;
    }

    const subject =
        prompt("Тема письма") || "";

    const body =
        prompt("Сообщение") || "";

    try {

        await api("/mail/message", {
            method: "POST",

            body: JSON.stringify({
                mailbox_id:
                    state.current._id,
                to,
                subject,
                body
            })
        });

        await loadMessages();

    } catch (error) {

        alert(error.message);
    }
};


/* =========================================================
   AI CHAT
========================================================= */

function addBubble(text, type) {

    const chat = $("#chat");

    if (!chat) {
        return;
    }

    chat.insertAdjacentHTML(
        "beforeend",

        `
        <div class="bubble ${type}">
            ${esc(text)}
        </div>
        `
    );

    chat.scrollTop =
        chat.scrollHeight;
}


async function sendAI(text, options = {}) {

    text = String(text || "").trim();

    if (!text) {
        return;
    }

    addBubble(text, "user");

    $("#chatInput").value = "";

    try {

        const data =
            await api("/ai/chat", {
                method: "POST",

                body: JSON.stringify({
                    message: text
                })
            });

        const answer =
            data.answer || "ИИ не дал ответа.";

        addBubble(
            answer,
            "ai"
        );

        handleAction(answer);

        if (
            options.speak !== false
        ) {
            speak(answer);
        }

    } catch (error) {

        addBubble(
            "Ошибка: " +
            error.message,
            "ai"
        );

        speak(
            "Произошла ошибка при обращении к искусственному интеллекту."
        );
    }
}


$("#send").onclick = () => {

    sendAI(
        $("#chatInput")
            .value
            .trim()
    );
};


$("#chatInput").onkeydown = event => {

    if (event.key === "Enter") {
        event.preventDefault();
        $("#send").click();
    }
};


/* =========================================================
   AI ACTIONS
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

    if (command === "OPEN_MAIL") {

        openPage("mail");

        speak("Открываю Pinmail.");

        return;
    }

    if (command === "OPEN_GOV") {

        openPage("gov");

        speak("Открываю государственные услуги.");

        return;
    }

    if (action[2]) {

        const username =
            action[2].toLowerCase();

        api("/pinmail/create", {
            method: "POST",

            body: JSON.stringify({
                username
            })
        })
        .then(() => {

            openPage("mail");

            loadMailboxes();

            addBubble(
                `Почтовый адрес ${username}@pinmail.pin создан.`,
                "ai"
            );

            speak(
                `Почтовый адрес ${username} на Pinmail создан.`
            );

        })
        .catch(error => {

            addBubble(
                "Не удалось создать почту: " +
                error.message,
                "ai"
            );

            speak(
                "Не удалось создать почтовый адрес."
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
            await api("/ai/history");

        $("#chat").innerHTML = "";

        (data.messages || [])
            .forEach(message => {

                addBubble(
                    message.content,

                    message.role === "user"
                        ? "user"
                        : "ai"
                );
            });

    } catch (error) {

        console.error(
            "AI history error:",
            error
        );
    }
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

    text = String(text || "");

    /*
     * Убираем технические ACTION-команды
     * перед озвучиванием.
     */
    text = text
        .replace(
            /ACTION:\s*[A-Z_]+(?::[a-z0-9._-]+)?/gi,
            ""
        )
        .trim();

    if (!text) {
        return;
    }

    window.speechSynthesis.cancel();

    const utterance =
        new SpeechSynthesisUtterance(text);

    utterance.lang = "ru-RU";
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1;

    const voices =
        window.speechSynthesis.getVoices();

    const russianVoice =
        voices.find(voice =>
            voice.lang &&
            voice.lang.toLowerCase()
                .startsWith("ru")
        );

    if (russianVoice) {
        utterance.voice =
            russianVoice;
    }

    window.speechSynthesis.speak(
        utterance
    );
}


/* =========================================================
   MICROPHONE
========================================================= */

async function requestMicrophone() {

    if (
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia
    ) {
        throw new Error(
            "Этот браузер не поддерживает доступ к микрофону."
        );
    }

    if (audioStream) {
        return audioStream;
    }

    try {

        audioStream =
            await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });

        return audioStream;

    } catch (error) {

        console.error(
            "Microphone permission error:",
            error
        );

        if (
            error.name ===
            "NotAllowedError"
        ) {
            throw new Error(
                "Доступ к микрофону запрещён. Разрешите микрофон для этого сайта в настройках браузера."
            );
        }

        if (
            error.name ===
            "NotFoundError"
        ) {
            throw new Error(
                "Микрофон не найден."
            );
        }

        throw new Error(
            "Не удалось получить доступ к микрофону: " +
            error.message
        );
    }
}


/* =========================================================
   AUDIO VISUALIZER
========================================================= */

async function startAudioVisualizer() {

    const stream =
        await requestMicrophone();

    if (!audioContext) {

        audioContext =
            new (
                window.AudioContext ||
                window.webkitAudioContext
            )();

        analyser =
            audioContext.createAnalyser();

        analyser.fftSize = 256;

        analyser.smoothingTimeConstant =
            0.75;

        microphoneSource =
            audioContext.createMediaStreamSource(
                stream
            );

        microphoneSource.connect(
            analyser
        );
    }

    if (
        audioContext.state ===
        "suspended"
    ) {
        await audioContext.resume();
    }

    animateOrb();
}


function animateOrb() {

    cancelAnimationFrame(
        volumeAnimation
    );

    const data =
        new Uint8Array(
            analyser.frequencyBinCount
        );

    const orb = $("#orb");

    function frame() {

        if (!voiceSession) {

            orb.style.transform = "";
            orb.style.filter = "";

            return;
        }

        analyser.getByteFrequencyData(
            data
        );

        let sum = 0;

        for (
            let i = 0;
            i < data.length;
            i++
        ) {
            sum += data[i];
        }

        const average =
            sum / data.length;

        /*
         * Усиливаем небольшую громкость
         * голоса, чтобы шар было хорошо видно.
         */
        const level =
            Math.min(
                1,
                average / 70
            );

        const scale =
            1 + level * 0.35;

        const glow =
            70 + level * 100;

        orb.style.transform =
            `scale(${scale})`;

        orb.style.filter =
            `drop-shadow(0 0 ${glow}px rgba(37,99,235,${0.35 + level * 0.45}))`;

        /*
         * Если пользователь говорит,
         * сбрасываем таймер тишины.
         */
        if (average > 10) {

            clearTimeout(
                silenceTimer
            );

            silenceTimer = null;
        }

        volumeAnimation =
            requestAnimationFrame(
                frame
            );
    }

    frame();
}


/* =========================================================
   VOICE RECOGNITION
========================================================= */

function createRecognition() {

    const Recognition =
        window.SpeechRecognition ||
        window.webkitSpeechRecognition;

    if (!Recognition) {
        return null;
    }

    const instance = new Recognition();

    instance.lang = "ru-RU";
    instance.interimResults = true;
    instance.continuous = true;
    instance.maxAlternatives = 1;


    instance.onstart = () => {

        recognitionRunning = true;

        $("#orb")
            .classList
            .add("listening");

        $("#orbStatus").textContent =
            "Слушаю… говорите";
    };


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
                result[0].transcript;

            if (result.isFinal) {
                finalText +=
                    transcript + " ";
            } else {
                interim += transcript;
            }
        }

        if (interim) {

            $("#orbStatus").textContent =
                "Слышу: " + interim;
        }

        if (finalText.trim()) {

            finalTranscript +=
                " " + finalText.trim();

            lastTranscript =
                finalTranscript.trim();

            $("#orbStatus").textContent =
                "Готовлю запрос…";
        }
    };


    instance.onerror = event => {

        console.warn(
            "Speech recognition:",
            event.error
        );

        if (event.error === "no-speech") {
            return;
        }

        if (event.error === "not-allowed") {

            $("#orbStatus").textContent =
                "Браузер запретил доступ к микрофону.";

            stopVoice();

            return;
        }

        if (event.error === "audio-capture") {

            $("#orbStatus").textContent =
                "Не найден микрофон.";

            stopVoice();

            return;
        }

        $("#orbStatus").textContent =
            "Ошибка распознавания речи.";
    };


    instance.onend = async () => {

        recognitionRunning = false;

        /*
         * Если голосовой режим ещё активен,
         * пытаемся продолжить распознавание.
         */
        if (
            voiceSession &&
            !finalTranscript.trim()
        ) {

            try {

                await new Promise(resolve => {
                    setTimeout(resolve, 150);
                });

                if (
                    voiceSession &&
                    recognition &&
                    !recognitionRunning
                ) {
                    recognition.start();
                }

            } catch (error) {

                console.warn(
                    "Не удалось продолжить распознавание:",
                    error
                );
            }

            return;
        }


        /*
         * Если речь распознана —
         * отправляем её в ИИ.
         */
        if (
            voiceSession &&
            finalTranscript.trim()
        ) {

            const text =
                finalTranscript.trim();

            finalTranscript = "";
            lastTranscript = "";

            voiceSession = false;

            stopAudioOnly();

            $("#orb")
                .classList
                .remove("listening");

            $("#orbStatus").textContent =
                "Обрабатываю запрос…";

            await sendAI(text);

            $("#orbStatus").textContent =
                "Нажмите на шар и говорите";

            return;
        }


        if (!voiceSession) {

            $("#orb")
                .classList
                .remove("listening");

            $("#orbStatus").textContent =
                "Нажмите на шар и говорите";
        }
    };

    return instance;
}


/* =========================================================
   START VOICE
========================================================= */

async function startVoice() {

    /*
     * Если шар уже слушает,
     * повторное нажатие останавливает его.
     */
    if (voiceSession) {

        stopVoice();

        return;
    }


    try {

        $("#orbStatus").textContent =
            "Запрашиваю доступ к микрофону…";


        /*
         * Запрашиваем микрофон
         * непосредственно после нажатия
         * пользователем на шар.
         */
        await requestMicrophone();


        /*
         * Запускаем анализ громкости.
         */
        await startAudioVisualizer();


        if (!recognition) {

            $("#orbStatus").textContent =
                "Распознавание речи не поддерживается этим браузером.";

            return;
        }


        finalTranscript = "";
        lastTranscript = "";

        voiceSession = true;


        $("#orb")
            .classList
            .add("listening");

        $("#orbStatus").textContent =
            "Слушаю…";


        try {

            recognition.start();

        } catch (error) {

            console.warn(
                "Recognition start:",
                error
            );
        }


    } catch (error) {

        voiceSession = false;

        stopAudioOnly();

        $("#orb")
            .classList
            .remove("listening");

        $("#orbStatus").textContent =
            error.message;


        if (
            error.message
                .toLowerCase()
                .includes("запрещ")
        ) {

            alert(
                error.message +
                "\n\nОткройте настройки разрешений браузера и разрешите этому сайту использовать микрофон."
            );
        }
    }
}


/* =========================================================
   STOP VOICE
========================================================= */

function stopVoice() {

    voiceSession = false;

    finalTranscript = "";
    lastTranscript = "";

    clearTimeout(
        silenceTimer
    );

    silenceTimer = null;


    if (recognition) {

        try {
            recognition.stop();
        } catch (error) {
            console.warn(error);
        }
    }


    recognitionRunning = false;

    stopAudioOnly();


    const orb = $("#orb");

    orb.classList.remove(
        "listening"
    );

    orb.style.transform = "";
    orb.style.filter = "";


    $("#orbStatus").textContent =
        "Нажмите на шар и говорите";
}


function stopAudioOnly() {

    cancelAnimationFrame(
        volumeAnimation
    );

    volumeAnimation = null;
}


/* =========================================================
   ORB BUTTON
========================================================= */

$("#orb").onclick = async () => {

    await startVoice();
};


/* =========================================================
   PAGE VISIBILITY
========================================================= */

document.addEventListener(
    "visibilitychange",
    () => {

        if (
            document.hidden &&
            voiceSession
        ) {
            stopVoice();
        }
    }
);


/* =========================================================
   SECURITY / HTML ESCAPING
========================================================= */

function esc(value) {

    return String(value ?? "")
        .replace(
            /[&<>"']/g,
            character => {

                const map = {

                    "&": "&amp;",
                    "<": "&lt;",
                    ">": "&gt;",
                    '"': "&quot;",
                    "'": "&#039;"
                };

                return map[character];
            }
        );
}


function escAttr(value) {

    return String(value ?? "")
        .replace(
            /&/g,
            "&amp;"
        )
        .replace(
            /"/g,
            "&quot;"
        )
        .replace(
            /'/g,
            "&#039;"
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
   BROWSER VOICE INITIALIZATION
========================================================= */

if (
    "speechSynthesis" in window
) {

    window.speechSynthesis.onvoiceschanged =
        () => {

            window.speechSynthesis.getVoices();
        };
}


/* =========================================================
   INITIALIZATION
========================================================= */

recognition =
    createRecognition();

start();
