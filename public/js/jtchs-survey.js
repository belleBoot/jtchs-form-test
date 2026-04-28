/**
 * JTCHS kiosk survey runner — ES5-style for old WebViews.
 * Expects window.JTCHS_CONFIG and window.JTCHS_QUESTIONS (set from survey.html).
 */
(function () {
  "use strict";

  function $(id) {
    return document.getElementById(id);
  }

  function hasFetch() {
    return typeof window.fetch === "function";
  }

  function httpPostJson(url, bodyObj, onDone, onErr) {
    var body = JSON.stringify(bodyObj);
    if (hasFetch()) {
      window
        .fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: body,
        })
        .then(function (res) {
          if (!res.ok) {
            return res.text().then(function (t) {
              throw new Error("HTTP " + res.status + ": " + (t || "").substring(0, 200));
            });
          }
          return res.json().catch(function () {
            return {};
          });
        })
        .then(function (data) {
          onDone(data);
        })
        .catch(function (e) {
          onErr(e);
        });
      return;
    }
    var xhr = new XMLHttpRequest();
    xhr.open("POST", url, true);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          onDone(xhr.responseText ? JSON.parse(xhr.responseText) : {});
        } catch (ex) {
          onDone({});
        }
      } else {
        onErr(new Error("HTTP " + xhr.status));
      }
    };
    xhr.onerror = function () {
      onErr(new Error("Network error"));
    };
    xhr.send(body);
  }

  function httpPostBlob(url, bodyObj, onBlob, onErr) {
    var body = JSON.stringify(bodyObj);
    if (hasFetch()) {
      window
        .fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body })
        .then(function (res) {
          if (!res.ok) {
            return res.text().then(function (t) {
              throw new Error("HTTP " + res.status + ": " + (t || "").substring(0, 200));
            });
          }
          return res.blob();
        })
        .then(onBlob)
        .catch(onErr);
      return;
    }
    var xhr = new XMLHttpRequest();
    xhr.open("POST", url, true);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.responseType = "blob";
    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status < 300) onBlob(xhr.response);
      else onErr(new Error("HTTP " + xhr.status));
    };
    xhr.onerror = function () {
      onErr(new Error("Network error"));
    };
    xhr.send(body);
  }

  var cfg = window.JTCHS_CONFIG || {};
  var WORKER_URL = cfg.workerTtsUrl || "";
  var SUBMIT_URL = cfg.submitUrl || "";
  var FORMBRICKS = cfg.formbricks || null;
  var QUESTIONS = window.JTCHS_QUESTIONS || [];
  var submitText =
    cfg.submitText ||
    "Thank you for completing the survey. Your responses have been recorded.";
  var totalPages = QUESTIONS.length;

  var currentPage = 1;
  var muted = false;
  var currentAudio = null;
  var audioCache = {};
  var audioUnlocked = false;
  var pendingText = null;
  var answers = [];
  var selectedChoice = null;
  var submitting = false;

  var i;
  for (i = 0; i < totalPages; i++) {
    answers.push(null);
  }

  var debugPanel = $("debug-panel");
  var statusDot = $("status-dot");
  var statusText = $("status-text");
  var waveform = $("waveform");
  var qCounter = $("q-counter");
  var toast = $("toast");
  var startOverlay = $("start-overlay");
  var questionEl = $("question-text");
  var choicesEl = $("choices");
  var btnBack = $("btn-back");
  var btnNext = $("btn-next");
  var toastTimer;

  function log(msg, type) {
    var line = document.createElement("div");
    line.className = "log-line " + (type || "info");
    line.textContent =
      "[" +
      new Date().toLocaleTimeString("en-US", { hour12: false }) +
      "] " +
      msg;
    debugPanel.appendChild(line);
    debugPanel.scrollTop = debugPanel.scrollHeight;
    if (type === "err") debugPanel.classList.add("visible");
  }

  function setStatus(s, t) {
    statusDot.className = s || "";
    statusText.textContent = t || "Ready";
  }
  function setWave(on) {
    if (waveform) waveform.classList.toggle("active", on);
  }
  function updateCounter(p) {
    qCounter.textContent = "Page " + p + " / " + totalPages;
  }
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.classList.remove("show");
    }, 2800);
  }

  function currentQuestion() {
    return QUESTIONS[currentPage - 1];
  }

  function stopAudio() {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.onended = null;
      currentAudio = null;
    }
    setWave(false);
  }

  function playBlob(blob) {
    var url = URL.createObjectURL(blob);
    var audio = new Audio(url);
    currentAudio = audio;
    audio.onplay = function () {
      setStatus("playing", "Playing…");
      setWave(true);
      log("▶ Playing", "ok");
    };
    audio.onended = function () {
      setStatus("", "Ready");
      setWave(false);
      URL.revokeObjectURL(url);
      log("■ Done");
    };
    audio.onerror = function () {
      log("Playback error", "err");
      setStatus("error", "Playback error");
      setWave(false);
    };
    audio.play().catch(function (err) {
      log("Autoplay blocked: " + err.message, "err");
      setStatus("", "Tap to play");
      showToast("Tap Replay after selecting an answer");
    });
  }

  function fetchAndPlay(text) {
    if (muted || !text || !WORKER_URL) {
      if (!WORKER_URL && text) log("No workerTtsUrl — skipping audio", "info");
      return;
    }
    if (!audioUnlocked) {
      log('Audio not yet unlocked — queuing: "' + text.substring(0, 40) + '"');
      pendingText = text;
      return;
    }
    stopAudio();
    if (audioCache[text]) {
      log("Cache hit — playing instantly", "ok");
      playBlob(audioCache[text]);
      return;
    }
    setStatus("loading", "Generating…");
    log('POST → TTS: "' + text.substring(0, 50) + '"');
    httpPostBlob(
      WORKER_URL,
      { text: text },
      function (blob) {
        log("Audio: " + (blob.size / 1024).toFixed(1) + " KB", "ok");
        audioCache[text] = blob;
        playBlob(blob);
      },
      function (err) {
        log("FAILED: " + (err && err.message ? err.message : err), "err");
        setStatus("error", "Error — see Debug");
        setWave(false);
        showToast("Audio error — open Debug");
      }
    );
  }

  function ttsForPage() {
    var q = currentQuestion();
    return q ? q.tts : "";
  }

  function renderQuestion() {
    var q = currentQuestion();
    if (!q) return;
    selectedChoice = answers[currentPage - 1];
    questionEl.textContent = q.title;
    choicesEl.innerHTML = "";
    var opts = q.choices || [];
    var j;
    for (j = 0; j < opts.length; j++) {
      (function (label, idx) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "choice-btn";
        if (selectedChoice === label) b.className += " selected";
        b.textContent = label;
        b.addEventListener("click", function () {
          selectedChoice = label;
          answers[currentPage - 1] = label;
          renderQuestion();
        });
        choicesEl.appendChild(b);
      })(opts[j], j);
    }
    btnBack.style.visibility = currentPage <= 1 ? "hidden" : "visible";
    btnNext.textContent = currentPage >= totalPages ? "Submit" : "Next";
    updateCounter(currentPage);
  }

  function goNext() {
    if (!answers[currentPage - 1]) {
      showToast("Please select an answer");
      return;
    }
    if (currentPage < totalPages) {
      currentPage++;
      renderQuestion();
      fetchAndPlay(ttsForPage());
      return;
    }
    doSubmit();
  }

  function goBack() {
    if (currentPage <= 1) return;
    currentPage--;
    renderQuestion();
    fetchAndPlay(ttsForPage());
  }

  function doSubmit() {
    if (submitting) return;
    submitting = true;
    btnNext.disabled = true;

    var payload = {
      version: 1,
      completedAt: new Date().toISOString(),
      answers: [],
    };
    for (var k = 0; k < totalPages; k++) {
      payload.answers.push({
        index: k + 1,
        id: QUESTIONS[k].id || "q" + (k + 1),
        question: QUESTIONS[k].title,
        choice: answers[k],
      });
    }

    function doneOk() {
      updateCounter(totalPages);
      fetchAndPlay(submitText);
      showToast("Survey submitted");
      questionEl.textContent = "Thank you";
      choicesEl.innerHTML = "";
      btnBack.style.visibility = "hidden";
      btnNext.style.display = "none";
      submitting = false;
    }

    function doneFail(msg) {
      submitting = false;
      btnNext.disabled = false;
      log("Submit failed: " + msg, "err");
      showToast("Submit failed — see Debug");
    }

    function isFormbricksConfigured() {
      return (
        FORMBRICKS &&
        typeof FORMBRICKS.appUrl === "string" &&
        FORMBRICKS.appUrl &&
        typeof FORMBRICKS.environmentId === "string" &&
        FORMBRICKS.environmentId &&
        typeof FORMBRICKS.surveyId === "string" &&
        FORMBRICKS.surveyId
      );
    }

    function submitToFormbricks() {
      var appUrl = FORMBRICKS.appUrl.replace(/\/+$/, "");
      var environmentId = FORMBRICKS.environmentId;
      var surveyId = FORMBRICKS.surveyId;
      var dataMap = FORMBRICKS.dataMap || {};

      var data = {};
      for (var idx = 0; idx < totalPages; idx++) {
        var kioskId = QUESTIONS[idx].id || "q" + (idx + 1);
        var elementId = dataMap[kioskId];
        if (!elementId) continue;
        data[elementId] = answers[idx];
      }

      var url = appUrl + "/api/v2/client/" + environmentId + "/responses";
      var body = {
        surveyId: surveyId,
        finished: true,
        data: data,
        meta: {
          source: "pepper-kiosk",
          url: (function () {
            try {
              return String(window.location && window.location.href ? window.location.href : "");
            } catch (e) {
              return "";
            }
          })(),
        },
      };

      log("Submitting to Formbricks v2 client API", "info");
      httpPostJson(
        url,
        body,
        function (res) {
          var id = res && res.data && res.data.id ? res.data.id : res && res.id ? res.id : null;
          log("Formbricks submit OK" + (id ? " | id=" + id : ""), "ok");
          doneOk();
        },
        function (e) {
          doneFail(e && e.message ? e.message : String(e));
        }
      );
    }

    if (!SUBMIT_URL && isFormbricksConfigured()) {
      submitToFormbricks();
      return;
    }

    if (!SUBMIT_URL) {
      log("No submitUrl — demo mode (not sent)", "info");
      try {
        localStorage.setItem("jtchs_last_response", JSON.stringify(payload));
      } catch (e2) {}
      doneOk();
      return;
    }

    httpPostJson(
      SUBMIT_URL,
      payload,
      function () {
        log("Submit OK", "ok");
        doneOk();
      },
      function (e) {
        doneFail(e && e.message ? e.message : String(e));
      }
    );
  }

  $("btn-start").addEventListener("click", function () {
    audioUnlocked = true;
    startOverlay.classList.add("hidden");
    log("Audio unlocked", "ok");
    if (pendingText) {
      var t = pendingText;
      pendingText = null;
      fetchAndPlay(t);
    }
  });

  document.getElementById("btn-debug").addEventListener("click", function () {
    debugPanel.classList.toggle("visible");
  });

  document.getElementById("btn-replay").addEventListener("click", function () {
    if (muted) {
      showToast("Unmute first");
      return;
    }
    if (!audioUnlocked) {
      audioUnlocked = true;
      startOverlay.classList.add("hidden");
    }
    fetchAndPlay(ttsForPage());
    showToast("Replaying…");
  });

  document.getElementById("btn-mute").addEventListener("click", function () {
    muted = !muted;
    var self = this;
    if (muted) {
      stopAudio();
      self.textContent = "Unmute";
      self.classList.add("muted");
      setStatus("", "Muted");
      setWave(false);
      showToast("Audio muted");
    } else {
      self.textContent = "Mute";
      self.classList.remove("muted");
      setStatus("", "Ready");
      showToast("Audio on");
    }
  });

  btnNext.addEventListener("click", goNext);
  btnBack.addEventListener("click", goBack);

  window.addEventListener("load", function () {
    if (!totalPages) {
      log("JTCHS_QUESTIONS missing or empty", "err");
      questionEl.textContent = "Configuration error";
      return;
    }
    updateCounter(1);
    renderQuestion();
    log("JTCHS survey (no Tally) | questions=" + totalPages, "ok");
    var firstTts = ttsForPage();
    pendingText = firstTts;
    if (WORKER_URL) {
      setTimeout(function () {
        log("Pre-fetching page 1 audio…");
        httpPostBlob(
          WORKER_URL,
          { text: firstTts },
          function (blob) {
            audioCache[firstTts] = blob;
            log("Welcome audio pre-cached", "ok");
          },
          function (err) {
            log("Pre-fetch failed: " + (err && err.message ? err.message : err), "err");
          }
        );
      }, 400);
    }
  });
})();
