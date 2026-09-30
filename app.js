const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

let token = localStorage.getItem("pin_token");

let state = {
    user: null,
    mailboxes: [],
    current: null
};

async function api(path, options = {}) {
    options.headers = {
        "Content-Type": "application/json",
        ...(options.headers || {})
    };

    if (token) {
        options.headers.Authorization = "Bearer " + token;
    }

    const response = await fetch("/api" + path, options);
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.error || "Произошла ошибка");
    }

    return data;
}


/* =========================
   AUTH
========================= */

function showAuth(type) {
    $$(".tab").forEach(tab => {
        tab.classList.toggle("active", tab.dataset.auth === type);
    });

    $("#loginForm").hidden = type !== "login";
    $("#registerForm").hidden = type !== "register";
    $("#authError").textContent = "";
}

$$(".tab").forEach(tab => {
    tab.onclick = () => showAuth(tab.dataset.auth);
});


$("#loginForm").onsubmit = async event => {
    event.preventDefault();

    try {
        const data = await api("/auth/login", {
            method: "POST",
            body: JSON.stringify(
                Object.fromEntries(new FormData(event.target))
            )
        });

        token = data.token;

        localStorage.setItem("pin_token", token);

        await start();

    } catch (error) {
        $("#authError").textContent = error.message;
    }
};


$("#registerForm").onsubmit = async event => {
    event.preventDefault();

    try {
        const data = await api("/auth/register", {
            method: "POST",
            body: JSON.stringify(
                Object.fromEntries(new FormData(event.target))
            )
        });

        token = data.token;

        localStorage.setItem("pin_token", token);

        await start();

    } catch (error) {
        $("#authError").textContent = error.message;
    }
};


/* =========================
   APPLICATION
========================= */

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

        $("#profile").innerHTML = `
            <b>
                ${esc(data.user.passport.first_name)}
                ${esc(data.user.passport.last_name)}
            </b>
            <br>
            ${esc(data.user.passport.position)}
            <br>
            ${esc(data.user.passport.rank)}
        `;

        await loadMailboxes();
        await loadChat();

    } catch (error) {

        localStorage.removeItem("pin_token");

        token = null;

        await start();
    }
}


/* =========================
   NAVIGATION
========================= */

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


/* =========================
   LOGOUT
========================= */

$("#logout").onclick = () => {

    localStorage.removeItem("pin_token");

    token = null;

    location.reload();
};


/* =========================
   PINMAIL
========================= */

async function loadMailboxes() {

    try {

        const data = await api("/pinmail");

        state.mailboxes = data.mailboxes;

        if (!state.mailboxes.length) {

            $("#mailboxes").innerHTML = `
                <div class="card">
                    <h3>У вас пока нет Pinmail</h3>

                    <p class="muted">
                        Создайте первый адрес электронной почты
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
                            onclick="selectMailbox('${mailbox._id}')"
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

        console.error(error);
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
            mailbox => mailbox._id === id
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
                "/mail/" + state.current._id
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

        console.error(error);
    }
}


/* =========================
   SEND MAIL
========================= */

$("#compose").onclick = async () => {

    if (!state.current) {
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


/* =========================
   AI CHAT
========================= */

function addBubble(text, type) {

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


async function sendAI(text) {

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

        addBubble(data.answer, "ai");

        handleAction(data.answer);

    } catch (error) {

        addBubble(
            "Ошибка: " + error.message,
            "ai"
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
        $("#send").click();
    }
};


/* =========================
   AI ACTIONS
========================= */

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

    } else if (command === "OPEN_GOV") {

        openPage("gov");

    } else if (action[2]) {

        api("/pinmail/create", {

            method: "POST",

            body: JSON.stringify({
                username: action[2]
            })
        })
        .then(() => {

            openPage("mail");

            loadMailboxes();

        })
        .catch(error => {

            addBubble(
                error.message,
                "ai"
            );
        });
    }
}


/* =========================
   AI HISTORY
========================= */

async function loadChat() {

    try {

        const data =
            await api("/ai/history");

        $("#chat").innerHTML = "";

        data.messages.forEach(message => {

            addBubble(
                message.content,

                message.role === "user"
                    ? "user"
                    : "ai"
            );
        });

    } catch (error) {

        console.error(error);
    }
}


/* =========================
   VOICE INPUT
========================= */

let recognition = null;

if (
    "webkitSpeechRecognition" in window ||
    "SpeechRecognition" in window
) {

    const Recognition =
        window.SpeechRecognition ||
        window.webkitSpeechRecognition;

    recognition = new Recognition();

    recognition.lang = "ru-RU";

    recognition.interimResults = true;

    recognition.onstart = () => {

        $("#orb")
            .classList
            .add("listening");

        $("#orbStatus").textContent =
            "Слушаю…";
    };

    recognition.onend = () => {

        $("#orb")
            .classList
            .remove("listening");

        $("#orbStatus").textContent =
            "Нажмите на шар и говорите";
    };

    recognition.onresult = event => {

        const text =
            [...event.results]
                .map(result =>
                    result[0].transcript
                )
                .join("");

        const last =
            event.results[
                event.results.length - 1
            ];

        if (last.isFinal) {

            sendAI(text);
        }
    };
}


$("#orb").onclick = () => {

    if (!recognition) {

        $("#orbStatus").textContent =
            "Голосовой ввод не поддерживается этим браузером";

        return;
    }

    try {

        recognition.start();

    } catch (error) {

        recognition.stop();
    }
};


/* =========================
   SECURITY
========================= */

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


/* =========================
   START
========================= */

start();
