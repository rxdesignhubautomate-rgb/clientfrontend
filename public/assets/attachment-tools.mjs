export function createAttachmentTools(c) {
  const {
    s,
    $,
    esc,
    notify,
    request,
    post,
    chatPath,
    current,
    renderMessages,
    renderHeader,
    renderChats,
    mediaType,
    form,
    button,
    bind,
    closeDrawer,
    download,
  } = c;
  let files = [],
    modal = null,
    cleanup = () => {},
    wave = null,
    sending = false;
  const previewFiles = new Map();
  function closeModal() {
    cleanup();
    cleanup = () => {};
    if (modal) {
      modal.close?.();
      modal.remove();
      modal = null;
    }
  }
  function dialog(title, html) {
    closeModal();
    modal = document.createElement("dialog");
    modal.className = "wa-media-dialog";
    modal.setAttribute("aria-label", title);
    modal.innerHTML = `<header><h2>${esc(title)}</h2><button type="button" id="wxModalClose" aria-label="Close">×</button></header>${html}`;
    document.body.append(modal);
    if (modal.showModal) modal.showModal();
    else modal.setAttribute("open", "");
    $("wxModalClose").onclick = closeModal;
    modal.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeModal();
    });
    return modal;
  }
  function attachFiles(incoming) {
    if (!current() || !s.modern) return;
    const valid = [];
    for (let file of incoming) {
      try {
        if (!file) continue;
        if (!file.type) {
          const ext = file.name.split(".").at(-1).toLowerCase(),
            mime = {
              jpg: "image/jpeg",
              jpeg: "image/jpeg",
              png: "image/png",
              pdf: "application/pdf",
              txt: "text/plain",
              mp3: "audio/mpeg",
              mp4: "video/mp4",
              docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            }[ext];
          if (mime) file = new File([file], file.name, { type: mime });
        }
        const type = mediaType(file),
          limit = (type === "image" ? 5 : 16) * 1024 * 1024;
        if (!file.size || file.size > limit)
          throw new Error(
            `${file.name}: maximum ${type === "image" ? 5 : 16} MB.`,
          );
        if (files.length + valid.length >= 10)
          throw new Error("Choose up to 10 files at a time.");
        if (
          [...files, ...valid].reduce((n, f) => n + f.file.size, 0) +
            file.size >
          50 * 1024 * 1024
        )
          throw new Error("Keep the combined selection below 50 MB.");
        valid.push({
          id: crypto.randomUUID(),
          file,
          type,
          url: URL.createObjectURL(file),
          caption: "",
          status: "ready",
        });
      } catch (error) {
        notify(error.message);
      }
    }
    files.push(...valid);
    if (valid.length) closeDrawer();
    renderFiles();
  }
  function renderFiles() {
    $("waAttachmentPreview").hidden = !files.length;
    $("waAttachmentPreview").innerHTML = files
      .map(
        (f) =>
          `<article class="wa-file-preview" data-file="${f.id}">${f.type === "image" ? `<img src="${f.url}" alt="${esc(f.file.name)}">` : f.type === "audio" ? `<audio controls src="${f.url}"></audio>` : f.type === "video" ? `<video controls preload="metadata" src="${f.url}"></video>` : '<span class="wa-file-symbol">▧</span>'}<div><strong>${esc(f.file.name)}</strong><small>${(f.file.size / 1024).toFixed(0)} KB · ${esc(f.status)}</small>${f.type !== "audio" ? `<input data-caption="${f.id}" maxlength="1024" placeholder="Caption for this file" aria-label="Caption for ${esc(f.file.name)}" value="${esc(f.caption)}" ${sending ? "disabled" : ""}>` : ""}</div>${f.type === "image" ? `<button type="button" data-edit-file="${f.id}" ${sending ? "disabled" : ""}>Edit photo</button>` : ""}<button type="button" data-remove-file="${f.id}" aria-label="Remove ${esc(f.file.name)}" ${sending ? "disabled" : ""}>×</button></article>`,
      )
      .join("");
    document.querySelectorAll("[data-caption]").forEach(
      (i) =>
        (i.oninput = () => {
          files.find((f) => f.id === i.dataset.caption).caption = i.value;
        }),
    );
    document.querySelectorAll("[data-remove-file]").forEach(
      (b) =>
        (b.onclick = () => {
          const f = files.find((f) => f.id === b.dataset.removeFile);
          URL.revokeObjectURL(f.url);
          files = files.filter((e) => e !== f);
          renderFiles();
        }),
    );
    document
      .querySelectorAll("[data-edit-file]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            editPhoto(files.find((f) => f.id === b.dataset.editFile)).catch(
              (e) => notify(e.message),
            )),
      );
    $("waDraft").placeholder = files.length
      ? "Optional caption for the first file"
      : "Type a message";
    c.syncComposer();
    renderHeader();
  }
  function clearFiles() {
    files.forEach((f) => URL.revokeObjectURL(f.url));
    files = [];
    if ($("waAttachmentPreview")) {
      $("waAttachmentPreview").hidden = true;
      $("waAttachmentPreview").innerHTML = "";
    }
    c.syncComposer();
  }
  async function sendFiles() {
    if (sending || !files.length || $("waSend").disabled) return;
    const id = s.active,
      epoch = s.epoch,
      batch = [...files],
      text = $("waDraft").value.trim(),
      reply = s.reply;
    if (batch.some((f) => f.status === "unknown"))
      return notify(
        "A delivery needs review. Refresh the chat before removing or sending that file again.",
      );
    if (batch[0].type === "audio" && text)
      return notify(
        "Audio cannot have a caption. Clear the composer text and send it separately.",
      );
    if (text.length > 1024)
      return notify("Caption must be 1,024 characters or fewer.");
    sending = true;
    s.pending.set(id, { batch: true });
    renderFiles();
    try {
      for (let index = 0; index < batch.length; index++) {
        if (s.active !== id || s.epoch !== epoch) break;
        const f = batch[index],
          caption = f.caption || (index === 0 ? text : "");
        f.status = "sending";
        renderFiles();
        let message;
        try {
          if (s.preview) {
            message = {
              id: f.id,
              clientMessageId: f.id,
              role: "sales",
              type: f.type,
              text: caption,
              timestamp: new Date().toISOString(),
              status: "preview",
              media: {
                id: f.id,
                filename: f.file.name,
                mimeType: f.file.type,
                size: f.file.size,
              },
              ...(reply
                ? {
                    context: {
                      id: reply.whatsappMessageId || reply.id,
                      text: c.messagePreview(reply),
                    },
                  }
                : {}),
            };
            previewFiles.set(message.id, {
              file: f.file,
              url: URL.createObjectURL(f.file),
            });
          } else {
            const params = new URLSearchParams({
              clientMessageId: f.id,
              filename: f.file.name,
              caption,
              ...(reply ? { replyTo: reply.id } : {}),
            });
            const result = await request(
              `${chatPath(id)}/send-media?${params}`,
              {
                method: "POST",
                headers: { "Content-Type": f.file.type },
                body: f.file,
              },
            );
            message = result.message;
          }
          if (s.active !== id || s.epoch !== epoch) break;
          if (message) s.messages = c.mergeMessages(s.messages, [message]);
          if (s.preview) {
            s.previewThreads.set(id, s.messages);
            Object.assign(current(), {
              lastMessageText: caption || f.file.name,
              lastMessageType: f.type,
              lastMessageAt: message.timestamp,
              lastMessageRole: "sales",
              lastMessageStatus: "preview",
            });
          }
          files = files.filter((item) => item !== f);
          URL.revokeObjectURL(f.url);
          if (index === 0 && $("waDraft").value.trim() === text) {
            $("waDraft").value = "";
            s.drafts.delete(id);
            c.saveDraft(id, "");
          }
          renderMessages(true);
          renderChats();
          renderFiles();
        } catch (error) {
          f.status = "unknown";
          notify(error.message);
          break;
        }
      }
      if (s.active === id) {
        s.reply = null;
        c.renderReply();
        if (!s.preview) await c.fetchThread(false);
      }
    } finally {
      sending = false;
      s.pending.delete(id);
      if (s.active === id) {
        renderFiles();
        c.resizeDraft();
      }
    }
  }
  function showAttachments() {
    if (!current()) return;
    form(
      "Attach",
      `<div class="wa-attach-options"><button type="button" class="wa-attach-option" data-file-kind="photos">Photos & videos</button><button type="button" class="wa-attach-option" data-file-kind="documents">Documents</button><button type="button" class="wa-attach-option" data-file-kind="audio">Audio</button>${button("wxCamera", "Camera")}${button("wxContactCard", "Contact")}${button("wxLocation", "Location")}${button("wxCatalogue", "Catalogue")}${button("waAttachSamples", "Product samples")}</div><p>${s.preview ? "Preview files stay on this page and are never uploaded." : "Choose up to 10 files. Photos: 5 MB each; other files: 16 MB each; combined: 50 MB."}</p>`,
    );
    if (!s.modern) {
      const notice = document.createElement("p");
      notice.setAttribute("role", "status");
      notice.textContent =
        "File sending is not available on the connected backend yet. Deploy the updated backend to send photos, PDFs and audio. Emoji, text and product sample links still work.";
      $("waDrawerBody").prepend(notice);
      $("waDrawerBody")
        .querySelectorAll("button")
        .forEach((b) => {
          if (b.id !== "waAttachSamples") b.disabled = true;
        });
      bind("waAttachSamples", c.showSamples);
      return;
    }
    document
      .querySelectorAll("[data-file-kind]")
      .forEach((b) => (b.onclick = () => chooseFiles(b.dataset.fileKind)));
    bind("wxCamera", camera);
    bind("wxContactCard", () => c.messaging().contact());
    bind("wxLocation", () => c.messaging().location());
    bind("wxCatalogue", () => c.messaging().catalogue());
    bind("waAttachSamples", c.showSamples);
    for (const id of ["wxContactCard", "wxLocation", "wxCatalogue"])
      $(id).disabled = !c.available();
  }
  function chooseFiles(kind) {
    if (!current()) return;
    if (!s.modern) return showAttachments();
    const accept = {
      photos: "image/jpeg,image/png,video/mp4,video/3gpp",
      documents: ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt",
      audio: "audio/mpeg,audio/mp4,audio/aac,audio/ogg,audio/amr",
    }[kind];
    if (!accept) return;
    $("waFile").accept = accept;
    $("waFile").click();
  }
  async function mediaBlob(m) {
    if (previewFiles.has(m.id)) return previewFiles.get(m.id).file;
    if (previewFiles.has(m.media?.id)) return previewFiles.get(m.media.id).file;
    if (s.preview)
      throw new Error(
        "This sample has no attachment file. Attach a file to try the gallery.",
      );
    if (!m.media?.id)
      throw new Error(
        "This attachment is a shared link. Open the link from the conversation.",
      );
    return request(
      `${chatPath(s.active)}/messages/${encodeURIComponent(m.id)}/media`,
      { responseType: "blob" },
    );
  }
  async function lightbox(message, messages) {
    const photos = messages.filter(
      (m) => ["image", "sticker"].includes(m.type) && m.media && !m.mediaHidden,
    );
    let index = photos.findIndex((m) => m.id === message.id),
      url = "",
      scale = 1,
      load = 0;
    if (index < 0) return;
    dialog(
      "Photo viewer",
      '<div class="wa-lightbox-stage"><img id="wxLightboxImage" alt="Shared photo"></div><div class="wa-lightbox-actions"><button type="button" id="wxPrevPhoto" aria-label="Previous photo">←</button><span id="wxPhotoCount"></span><button type="button" id="wxNextPhoto" aria-label="Next photo">→</button><button type="button" id="wxZoomOut">−</button><output id="wxZoom">100%</output><button type="button" id="wxZoomIn">+</button><button type="button" id="wxDownloadPhoto">Download</button></div><p id="wxPhotoStatus" role="status"></p>',
    );
    cleanup = () => {
      load++;
      if (url) URL.revokeObjectURL(url);
    };
    const zoom = (delta) => {
      scale = Math.min(4, Math.max(0.5, scale + delta));
      $("wxLightboxImage").style.transform = `scale(${scale})`;
      $("wxZoom").textContent = Math.round(scale * 100) + "%";
    };
    const show = async () => {
      const token = ++load;
      $("wxPhotoStatus").textContent = "Loading…";
      $("wxPrevPhoto").disabled = index === 0;
      $("wxNextPhoto").disabled = index === photos.length - 1;
      $("wxPhotoCount").textContent = `${index + 1} / ${photos.length}`;
      try {
        const blob = await mediaBlob(photos[index]);
        if (token !== load || !$("wxLightboxImage")) return;
        if (url) URL.revokeObjectURL(url);
        url = URL.createObjectURL(blob);
        $("wxLightboxImage").src = url;
        scale = 1;
        zoom(0);
        $("wxPhotoStatus").textContent = photos[index].text || "";
        $("wxDownloadPhoto").onclick = () =>
          download(blob, photos[index].media?.filename || "photo.jpg");
      } catch (e) {
        if ($("wxPhotoStatus")) $("wxPhotoStatus").textContent = e.message;
      }
    };
    $("wxPrevPhoto").onclick = () => {
      if (index > 0) {
        index--;
        show();
      }
    };
    $("wxNextPhoto").onclick = () => {
      if (index < photos.length - 1) {
        index++;
        show();
      }
    };
    $("wxZoomIn").onclick = () => zoom(0.25);
    $("wxZoomOut").onclick = () => zoom(-0.25);
    await show();
  }
  async function camera() {
    if (!navigator.mediaDevices?.getUserMedia)
      return notify("Camera is unavailable. Choose a photo from your device.");
    const id = s.active;
    dialog(
      "Camera",
      '<video id="wxCameraVideo" class="wa-camera-video" autoplay playsinline muted></video><p id="wxCameraStatus">Opening camera…</p><button type="button" id="wxCapture" disabled>Take photo</button>',
    );
    const target = modal;
    let stream;
    cleanup = () => stream?.getTracks().forEach((t) => t.stop());
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      if (modal !== target || s.active !== id) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const video = $("wxCameraVideo");
      video.srcObject = stream;
      await video.play();
      $("wxCameraStatus").textContent = "";
      $("wxCapture").disabled = false;
      $("wxCapture").onclick = () => {
        if (!video.videoWidth) return;
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext("2d").drawImage(video, 0, 0);
        canvas.toBlob(
          (blob) => {
            if (!blob || s.active !== id) return;
            closeModal();
            attachFiles([
              new File([blob], `camera-${Date.now()}.jpg`, {
                type: "image/jpeg",
              }),
            ]);
            editPhoto(files.at(-1)).catch((e) => notify(e.message));
          },
          "image/jpeg",
          0.88,
        );
      };
    } catch (error) {
      if (modal === target)
        $("wxCameraStatus").textContent =
          error.name === "NotAllowedError"
            ? "Camera permission was not granted."
            : error.message;
    }
  }
  async function editPhoto(entry) {
    if (!entry) return;
    const image = new Image();
    image.src = entry.url;
    await image.decode();
    dialog(
      "Edit photo",
      `<div class="wa-editor-tools"><label>Tool<select id="wxEditTool"><option value="crop">Crop selection</option><option value="draw">Draw</option><option value="text">Add text</option></select></label><input id="wxEditColour" type="color" value="#ef4444" aria-label="Drawing and text colour"><input id="wxEditText" maxlength="100" placeholder="Text to add" aria-label="Text to add">${button("wxRotate", "Rotate")}${button("wxCrop", "Apply crop")}${button("wxUndo", "Undo")}${button("wxResetPhoto", "Reset")}${button("wxSavePhoto", "Use edited photo")}</div><p class="wa-muted">Drag to select a crop or draw. Choose Add text, enter text, then click its position.</p><div class="wa-editor-stage"><canvas id="wxEditCanvas" aria-label="Photo editor"></canvas></div>`,
    );
    const canvas = $("wxEditCanvas"),
      ctx = canvas.getContext("2d"),
      history = [];
    let active = false,
      start = null,
      selection = null,
      base = null;
    const snapshot = () => {
      history.push({
        width: canvas.width,
        height: canvas.height,
        pixels: ctx.getImageData(0, 0, canvas.width, canvas.height),
      });
      if (history.length > 6) history.shift();
    };
    const restore = (value) => {
      canvas.width = value.width;
      canvas.height = value.height;
      ctx.putImageData(value.pixels, 0, 0);
    };
    const reset = () => {
      const ratio = Math.min(1, 2400 / Math.max(image.width, image.height));
      canvas.width = Math.round(image.width * ratio);
      canvas.height = Math.round(image.height * ratio);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      selection = null;
    };
    reset();
    const point = (event) => {
      const r = canvas.getBoundingClientRect();
      return {
        x: ((event.clientX - r.left) * canvas.width) / r.width,
        y: ((event.clientY - r.top) * canvas.height) / r.height,
      };
    };
    canvas.onpointerdown = (event) => {
      event.preventDefault();
      active = true;
      canvas.setPointerCapture?.(event.pointerId);
      start = point(event);
      snapshot();
      const tool = $("wxEditTool").value;
      if (tool === "text") {
        ctx.fillStyle = $("wxEditColour").value;
        ctx.font = `${Math.max(24, canvas.width / 25)}px sans-serif`;
        ctx.fillText($("wxEditText").value, start.x, start.y);
        active = false;
      } else if (tool === "draw") {
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.strokeStyle = $("wxEditColour").value;
        ctx.lineWidth = Math.max(3, canvas.width / 250);
        ctx.lineCap = "round";
      } else base = ctx.getImageData(0, 0, canvas.width, canvas.height);
    };
    canvas.onpointermove = (event) => {
      if (!active) return;
      const p = point(event);
      if ($("wxEditTool").value === "draw") {
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      } else {
        ctx.putImageData(base, 0, 0);
        selection = {
          x: Math.max(0, Math.min(start.x, p.x)),
          y: Math.max(0, Math.min(start.y, p.y)),
          w: Math.abs(p.x - start.x),
          h: Math.abs(p.y - start.y),
        };
        ctx.strokeStyle = "#00a884";
        ctx.lineWidth = 3;
        ctx.strokeRect(selection.x, selection.y, selection.w, selection.h);
      }
    };
    canvas.onpointerup = () => {
      active = false;
      if ($("wxEditTool").value === "crop" && base)
        ctx.putImageData(base, 0, 0);
    };
    canvas.onpointercancel = () => (active = false);
    bind("wxCrop", () => {
      if (!selection || selection.w < 10 || selection.h < 10)
        return notify("Drag on the photo to select the crop area.");
      snapshot();
      const r = selection,
        w = Math.min(Math.round(r.w), canvas.width - Math.round(r.x)),
        h = Math.min(Math.round(r.h), canvas.height - Math.round(r.y)),
        pixels = ctx.getImageData(r.x, r.y, w, h);
      canvas.width = w;
      canvas.height = h;
      ctx.putImageData(pixels, 0, 0);
      selection = null;
    });
    bind("wxRotate", () => {
      snapshot();
      const temp = document.createElement("canvas");
      temp.width = canvas.width;
      temp.height = canvas.height;
      temp.getContext("2d").drawImage(canvas, 0, 0);
      canvas.width = temp.height;
      canvas.height = temp.width;
      ctx.translate(canvas.width, 0);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(temp, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      selection = null;
    });
    bind("wxUndo", () => {
      if (history.length) restore(history.pop());
      selection = null;
    });
    bind("wxResetPhoto", () => {
      snapshot();
      reset();
    });
    bind(
      "wxSavePhoto",
      () =>
        new Promise((resolve) =>
          canvas.toBlob(
            (blob) => {
              if (blob && files.includes(entry)) {
                if (blob.size > 5 * 1024 * 1024) {
                  notify(
                    "Edited photo exceeds 5 MB. Crop it or use a smaller image.",
                  );
                  resolve();
                  return;
                }
                URL.revokeObjectURL(entry.url);
                entry.file = new File(
                  [blob],
                  entry.file.name.replace(/\.[^.]+$/, "") + "-edited.jpg",
                  { type: "image/jpeg" },
                );
                entry.url = URL.createObjectURL(entry.file);
                entry.id = crypto.randomUUID();
                closeModal();
                renderFiles();
              }
              resolve();
            },
            "image/jpeg",
            0.9,
          ),
        ),
    );
  }
  function stopWave() {
    if (!wave) return;
    cancelAnimationFrame(wave.frame);
    wave.source.disconnect();
    wave.context.close().catch(() => {});
    wave = null;
  }
  function recordingStarted(recording) {
    $("waRecording").insertAdjacentHTML(
      "beforeend",
      '<button type="button" id="wxPauseRecording">Pause</button><canvas id="wxWaveform" width="220" height="36" aria-label="Microphone waveform"></canvas>',
    );
    $("wxPauseRecording").onclick = () => {
      if (recording.recorder.state === "recording") {
        recording.recorder.pause();
        $("wxPauseRecording").textContent = "Resume";
      } else if (recording.recorder.state === "paused") {
        recording.recorder.resume();
        $("wxPauseRecording").textContent = "Pause";
      }
    };
    try {
      const context = new (window.AudioContext || window.webkitAudioContext)(),
        analyser = context.createAnalyser(),
        source = context.createMediaStreamSource(recording.stream),
        samples = new Uint8Array(256);
      analyser.fftSize = 256;
      source.connect(analyser);
      wave = { context, source, frame: 0 };
      const draw = () => {
        const canvas = $("wxWaveform");
        if (!wave || !canvas) return;
        const ctx = canvas.getContext("2d");
        analyser.getByteTimeDomainData(samples);
        ctx.clearRect(0, 0, 220, 36);
        ctx.strokeStyle = "#008b73";
        ctx.lineWidth = 2;
        ctx.beginPath();
        samples.forEach((v, i) => {
          const x = (i * 220) / samples.length,
            y = (v / 255) * 36;
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        });
        ctx.stroke();
        wave.frame = requestAnimationFrame(draw);
      };
      draw();
    } catch {
      /* Recording itself can still work when a waveform is unavailable. */
    }
  }
  $("waFile").multiple = true;
  $("waFile").onchange = () => {
    attachFiles([...$("waFile").files]);
    $("waFile").value = "";
  };
  $("whatsappWorkspace").addEventListener(
    "drop",
    (event) => {
      if (!s.active || !event.dataTransfer.files.length) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      attachFiles([...event.dataTransfer.files]);
    },
    true,
  );
  $("waDraft").addEventListener(
    "paste",
    (event) => {
      const items = [...(event.clipboardData?.items || [])].filter(
        (i) => i.kind === "file",
      );
      if (!items.length) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      attachFiles(items.map((i) => i.getAsFile()));
    },
    true,
  );
  function resetMedia() {
    stopWave();
    for (const value of previewFiles.values()) URL.revokeObjectURL(value.url);
    previewFiles.clear();
  }
  return {
    attachFiles,
    clearFiles,
    hasFiles: () => files.length > 0,
    sendFiles,
    showAttachments,
    chooseFiles,
    mediaBlob,
    lightbox,
    closeModal,
    recordingStarted,
    stopWave,
    resetMedia,
    previewMedia: (id) => previewFiles.get(id)?.url,
    registerPreviewFile: (id, file) => {
      const previous = previewFiles.get(id);
      if (previous?.url) URL.revokeObjectURL(previous.url);
      previewFiles.set(id, { file, url: URL.createObjectURL(file) });
    },
  };
}
