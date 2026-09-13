export async function readCampaignProgress(response, onProgress = () => {}) {
  const contentType = String(response.headers?.get("content-type") || "");
  if (!contentType.includes("application/x-ndjson") || !response.body?.getReader) {
    const result = await response.json();
    onProgress({
      type: "complete",
      total: result.requested || 0,
      completed: result.requested || 0,
      sent: result.sent || 0,
      failed: result.failed || 0,
      result,
    });
    return result;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult = null;
  const consume = (line) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === "error") throw new Error(event.error || "Campaign failed");
    if (event.type === "complete") finalResult = event.result;
    onProgress(event);
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    lines.forEach(consume);
    if (done) break;
  }
  consume(buffer);
  if (!finalResult) throw new Error("Campaign ended before completion.");
  return finalResult;
}

export function createMessagingTools(c) {
  const {
    s,
    $,
    x,
    esc,
    notify,
    request,
    post,
    chatPath,
    current,
    renderMessages,
    renderHeader,
    renderChats,
    form,
    button,
    bind,
    closeDrawer,
    requireAdvanced,
    insertDraft,
    resizeDraft,
    dateTime,
    withRxQuickReplies,
  } = c;
  function previewMessage(type, text, record = {}) {
    const message = {
      id: crypto.randomUUID(),
      role: "sales",
      type,
      text,
      status: "preview",
      timestamp: new Date().toISOString(),
      ...record,
    };
    s.messages = c.mergeMessages(s.messages, [message]);
    s.previewThreads.set(s.active, s.messages);
    Object.assign(current(), {
      lastMessageAt: message.timestamp,
      lastMessageText: text,
      lastMessageType: type,
      lastMessageRole: "sales",
      lastMessageStatus: "preview",
    });
    renderMessages(true);
    renderChats();
    return message;
  }
  async function sendStructured(body) {
    if (!current() || !requireAdvanced()) return;
    const id = s.active,
      epoch = s.epoch;
    if (s.preview) {
      if (body.type === "contacts")
        previewMessage("contacts", "", {
          contacts: [
            {
              name: { formatted_name: body.name },
              phones: [{ phone: body.phone }],
            },
          ],
        });
      else if (body.type === "location")
        previewMessage("location", body.name, {
          location: {
            latitude: Number(body.latitude),
            longitude: Number(body.longitude),
            name: body.name,
            address: body.address,
          },
        });
      else
        previewMessage(
          body.type,
          body.previewText || body.text || body.name || "Sample message",
        );
      return;
    }
    const result = await post(`${chatPath(id)}/send-structured`, {
      ...body,
      clientMessageId: crypto.randomUUID(),
    });
    if (s.active === id && s.epoch === epoch) {
      if (result.message)
        s.messages = c.mergeMessages(s.messages, [result.message]);
      await c.fetchThread(false);
      renderMessages(true);
    }
  }
  function newChat() {
    if (!requireAdvanced()) return;
    form(
      "New conversation",
      `<label>Contact name<input id="wxNewName" maxlength="100" autocomplete="name"></label><label>WhatsApp number<input id="wxNewPhone" type="tel" placeholder="+91 98765 43210" autocomplete="tel"></label><label class="wa-check"><input id="wxConsent" type="checkbox">Customer agreed to receive messages from our business</label><p class="wa-muted">Adding a contact does not send a message. Use an approved template when there is no open reply window.</p>${button("wxCreateChat", "Open conversation")}`,
    );
    bind("wxCreateChat", async () => {
      const phone = $("wxNewPhone").value.replace(/[\s()+-]/g, ""),
        name = $("wxNewName").value.trim(),
        consent = $("wxConsent").checked;
      if (!/^[1-9]\d{6,14}$/.test(phone))
        throw new Error("Enter a full phone number with country code.");
      const result = s.preview
        ? {
            lead: {
              id: "preview-" + crypto.randomUUID(),
              name: name || phone,
              phone,
              assignedTo: "ankit",
              aiEnabled: false,
              lastMessageAt: new Date().toISOString(),
              status: "new",
              view: {},
              unreadCount: 0,
              inboundCount: 0,
              unreadMessageCount: 0,
              readMessageCount: 0,
              readTrackingAvailable: true,
            },
          }
        : await post("/api/chats/new", { phone, name, consent });
      if (!s.chats.some((l) => l.id === result.lead.id))
        s.chats.push(result.lead);
      if (s.preview) s.previewThreads.set(result.lead.id, []);
      renderChats();
      closeDrawer();
      await c.openChat(result.lead.id);
    });
  }
  function quickReplies() {
    if (!requireAdvanced()) return;
    const shortcutLabel = (value) =>
      String(value || "")
        .trim()
        .replace(/^\/+/, "")
        .replace(/\s+/g, "");
    const shortcutTitle = (value) => {
      const label = shortcutLabel(value).toLowerCase();
      if (!/^[a-z0-9_-]{1,30}$/.test(label))
        throw new Error("Use one short word with letters, numbers, - or _.");
      return "/" + label;
    };
    const shortcuts = x.quickReplies
      .map((r, i) => {
        const label = String(r.label || shortcutLabel(r.title)).trim();
        return `<span class="wa-quick-item"><button type="button" class="wa-quick-chip" data-insert-quick="${i}" title="Insert ${esc(label)} reply" aria-label="Insert ${esc(label)} reply" ${current() ? "" : "disabled"}>${esc(label)}</button>${r.builtIn ? "" : `<button type="button" class="wa-quick-remove" data-remove-quick="${i}" title="Remove ${esc(label)}" aria-label="Remove ${esc(label)}">×</button>`}</span>`;
      })
      .join("");
    form(
      "Quick replies",
      `<p class="wa-muted">Tap a shortcut to add its full message. You can also type /shortcut in the message box.</p><div id="wxReplyList" class="wa-quick-grid" role="group" aria-label="Quick reply shortcuts">${shortcuts || "<p>No saved replies yet.</p>"}</div><details class="wa-quick-add"><summary>+ Add shortcut</summary><div><label>Shortcut name<input id="wxReplyName" maxlength="30" placeholder="thanks" autocomplete="off"></label><label>Message<textarea id="wxReplyText" rows="4" maxlength="4096" placeholder="Write the full reply…"></textarea></label>${button("wxSaveReply", "Save shortcut")}</div></details>`,
    );
    const save = async (replies) => {
      const customReplies = replies
        .filter((reply) => !reply.builtIn)
        .map(({ builtIn, ...reply }) => reply);
      if (s.preview) {
        x.quickReplies = withRxQuickReplies(customReplies);
        c.saveCache("quickReplies", customReplies);
      } else {
        const result = await post("/api/chats/quick-replies", {
          replies: customReplies,
        });
        x.quickReplies = withRxQuickReplies(result.replies);
      }
      quickReplies();
    };
    bind("wxSaveReply", async () => {
      const title = shortcutTitle($("wxReplyName").value),
        text = $("wxReplyText").value.trim();
      if (!text) throw new Error("Enter the full reply message.");
      if (
        x.quickReplies.some(
          (reply) => shortcutTitle(reply.title) === title,
        )
      )
        throw new Error("A quick reply with this name already exists.");
      await save([...x.quickReplies, { title, text }]);
    });
    document.querySelectorAll("[data-insert-quick]").forEach(
      (b) =>
        (b.onclick = () => {
          insertDraft(
            personalizedQuickReply(
              x.quickReplies[Number(b.dataset.insertQuick)].text,
            ),
          );
          closeDrawer();
        }),
    );
    document.querySelectorAll("[data-remove-quick]").forEach(
      (b) =>
        (b.onclick = async () => {
          try {
            await save(
              x.quickReplies.filter(
                (_, i) => i !== Number(b.dataset.removeQuick),
              ),
            );
          } catch (e) {
            notify(e.message);
          }
        }),
    );
  }
  function personalizedQuickReply(text) {
    const lead = current(),
      name = String(lead?.name || "").trim(),
      phone = String(lead?.phone || "").trim(),
      usableName =
        name && name.toLowerCase() !== "unknown" && name !== phone
          ? name
          : "Sir/Ma’am";
    return String(text || "").replaceAll("[Name]", usableName);
  }
  function expandQuickReply() {
    const input = $("waDraft"),
      command =
        "/" +
        input.value
          .trim()
          .replace(/^\/+/, "")
          .replace(/\s+/g, "")
          .toLowerCase(),
      reply = x.quickReplies.find(
        (candidate) =>
          "/" +
            String(candidate.title || "")
              .trim()
              .replace(/^\/+/, "")
              .replace(/\s+/g, "")
              .toLowerCase() ===
          command,
      );
    if (!reply) return false;
    input.value = personalizedQuickReply(reply.text);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    resizeDraft();
    input.focus();
    return true;
  }
  async function templates() {
    if (!current() || !requireAdvanced()) return;
    form(
      "Approved templates",
      '<p id="wxTemplateStatus">Loading approved templates…</p><div id="wxTemplateList"></div>',
    );
    let after = null;
    const all = [];
    async function load() {
      const data = s.preview
        ? {
            configured: true,
            templates: [
              {
                id: "demo",
                name: "sample_follow_up",
                language: "en",
                status: "APPROVED",
                components: [
                  {
                    type: "BODY",
                    text: "Hello {{1}}, thank you for your interest in our {{2}}. How can we help?",
                  },
                ],
              },
            ],
          }
        : await request(
            "/api/chats/templates" +
              (after ? "?after=" + encodeURIComponent(after) : ""),
          );
      if (!$("wxTemplateList")) return;
      all.push(...data.templates);
      after = data.nextCursor;
      $("wxTemplateStatus").textContent = data.configured
        ? s.preview
          ? "Sample template · preview only"
          : `${all.length} approved templates`
        : data.reason;
      $("wxTemplateList").innerHTML =
        all
          .map(
            (t, i) =>
              `<article class="wa-template-option"><button type="button" class="wa-picker-row" data-template="${i}"><strong>${esc(t.name)}</strong><small>${esc(t.language)} · Send to this chat</small></button>${s.preview || x.role === "admin" ? `<button type="button" class="wa-template-group-button" data-campaign-template="${i}">Send to group</button>` : ""}</article>`,
          )
          .join("") +
        (after ? button("wxMoreTemplates", "Load more templates") : "");
      document
        .querySelectorAll("[data-template]")
        .forEach(
          (b) =>
            (b.onclick = () => templateForm(all[Number(b.dataset.template)])),
        );
      document
        .querySelectorAll("[data-campaign-template]")
        .forEach(
          (b) =>
            (b.onclick = () =>
              templateForm(all[Number(b.dataset.campaignTemplate)], true)),
        );
      bind("wxMoreTemplates", load);
    }
    try {
      await load();
    } catch (e) {
      if ($("wxTemplateStatus")) $("wxTemplateStatus").textContent = e.message;
    }
  }
  function templateForm(template, campaign = false) {
    const fields = [];
    let unsupported = "",
      headerType = "";
    for (const item of template.components || []) {
      if (item.type === "HEADER" && item.format !== "TEXT") {
        headerType = String(item.format).toLowerCase();
        if (!["image", "video", "document"].includes(headerType))
          unsupported =
            "This specialised header requires a separate integration.";
      }
      if (item.type === "BUTTONS")
        for (const [index, b] of (item.buttons || []).entries()) {
          if (b.type === "URL" && /\{\{/.test(b.url || ""))
            fields.push({
              key: "BUTTON:" + index,
              label: "Value for " + b.text + " button",
            });
          if (["OTP", "FLOW", "COPY_CODE"].includes(b.type))
            unsupported =
              "This specialised template requires its dedicated integration.";
        }
      if (["BODY", "HEADER"].includes(item.type))
        for (const name of [
          ...new Set(
            [...String(item.text || "").matchAll(/\{\{([^}]+)\}\}/g)].map(
              (m) => m[1],
            ),
          ),
        ])
          fields.push({
            key: item.type + ":" + name,
            label: item.type.toLowerCase() + " " + name,
          });
    }
    const text =
      template.components?.find((i) => i.type === "BODY")?.text ||
      template.name;
    const campaignControls = campaign
      ? `<section class="wa-campaign-target"><strong>Choose one or more lead sections</strong><div id="wxCampaignTargets" class="wa-campaign-target-options" role="group" aria-label="Lead sections"><label class="wa-campaign-target-chip"><input type="checkbox" data-campaign-target value="follow_up" checked><span>Follow Up / Interested</span></label><label class="wa-campaign-target-chip"><input type="checkbox" data-campaign-target value="quote_sent"><span>Quotation Sent</span></label><label class="wa-campaign-target-chip"><input type="checkbox" data-campaign-target value="new"><span>New Leads</span></label><label class="wa-campaign-target-chip"><input type="checkbox" data-campaign-target value="hot"><span>Hot</span></label><label class="wa-campaign-target-chip"><input type="checkbox" data-campaign-target value="warm"><span>Warm</span></label><label class="wa-campaign-target-chip"><input type="checkbox" data-campaign-target value="cold"><span>Cold</span></label><label class="wa-campaign-target-chip wa-campaign-target-chip--all"><input type="checkbox" data-campaign-target value="all"><span>All Eligible Leads</span></label></div><label>Maximum in this batch<select id="wxCampaignLimit"><option value="25">25</option><option value="50">50</option><option value="100">100</option><option value="250" selected>250</option><option value="500">500</option></select></label><label class="wa-check"><input id="wxCampaignRepeat" type="checkbox">Include contacts who received this same template in the last 24 hours</label><small>Selected sections are combined. Overlapping contacts appear once. Opted-out and Lost contacts are always excluded.</small></section>`
      : "";
    const consentControl = campaign
      ? '<label class="wa-check wa-campaign-confirm"><input id="wxCampaignConsent" type="checkbox">I confirm these recipients agreed to receive WhatsApp business messages</label><div id="wxCampaignPreview" class="wa-campaign-preview" role="status">Preview recipients before sending.</div>'
      : '<label class="wa-check"><input id="wxTemplateConsent" type="checkbox">Customer agreed to receive business messages</label>';
    const action = unsupported
      ? `<p>${esc(unsupported)}</p>`
      : campaign
        ? `${button("wxPreviewCampaign", "Preview recipients")}${button("wxSendCampaign", "Send template to group", "wa-tool-button wa-campaign-send")} `
        : button(
            "wxSendTemplate",
            s.preview ? "Send to preview" : "Send template",
          );
    form(
      campaign ? `Group · ${template.name}` : template.name,
      `${campaignControls}<p>${esc(template.language)}</p><blockquote id="wxTemplatePreview">${esc(text)}</blockquote>${fields.map((f, i) => `<label>${esc(f.label)}<input data-template-field="${i}" maxlength="1024" ${campaign ? 'placeholder="Use a fixed value or {name}"' : ""}></label>`).join("")}${consentControl}${action}`,
    );
    if (headerType && !unsupported)
      $("wxTemplatePreview").insertAdjacentHTML(
        "afterend",
        `<label>Header ${esc(headerType)}<input id="wxTemplateHeader" type="file" accept="${headerType === "image" ? "image/jpeg,image/png" : headerType === "video" ? "video/mp4,video/3gpp" : ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"}"></label>`,
      );
    const parameters = () =>
      Object.fromEntries(
        [...document.querySelectorAll("[data-template-field]")].map((i) => [
          fields[Number(i.dataset.templateField)].key,
          i.value.trim(),
        ]),
      );
    const preview = () =>
      text.replace(
        /\{\{([^}]+)\}\}/g,
        (_, name) => parameters()["BODY:" + name] || `{{${name}}}`,
      );
    document.querySelectorAll("[data-template-field]").forEach(
      (i) =>
        (i.oninput = () => {
          $("wxTemplatePreview").textContent = preview();
        }),
    );
    if (campaign) {
      let recipientPreview = null;
      const campaignSettings = () => ({
        targets: [...document.querySelectorAll("[data-campaign-target]:checked")].map(
          (input) => input.value,
        ),
        limit: Number($("wxCampaignLimit").value),
        templateName: template.name,
        templateCategory: template.category || "",
        allowRecentRepeat: $("wxCampaignRepeat").checked,
      });
      const previewKey = () => JSON.stringify(campaignSettings());
      const invalidatePreview = () => {
        recipientPreview = null;
        $("wxCampaignPreview").textContent =
          "Selection changed. Preview recipients again.";
        $("wxSendCampaign").disabled = true;
      };
      document.querySelectorAll("[data-campaign-target]").forEach((input) => {
        input.onchange = () => {
          const all = document.querySelector(
            '[data-campaign-target][value="all"]',
          );
          if (input.value === "all" && input.checked) {
            document
              .querySelectorAll('[data-campaign-target]:not([value="all"])')
              .forEach((item) => (item.checked = false));
          } else if (input.checked && all) {
            all.checked = false;
          }
          invalidatePreview();
        };
      });
      ["wxCampaignLimit", "wxCampaignRepeat"].forEach(
        (id) => ($(`${id}`).onchange = invalidatePreview),
      );
      $("wxSendCampaign").disabled = true;
      bind("wxPreviewCampaign", async () => {
        const settings = campaignSettings();
        if (!settings.targets.length) {
          $("wxCampaignPreview").textContent =
            "Select at least one lead section.";
          $("wxSendCampaign").disabled = true;
          return;
        }
        const data = s.preview
          ? {
              count: Math.min(settings.limit, 6),
              sample: s.chats.slice(0, 5),
              recentDuplicatesExcluded: !settings.allowRecentRepeat,
            }
          : await post("/api/leads/broadcast/preview", settings);
        recipientPreview = { ...data, key: previewKey() };
        const sample = (data.sample || [])
          .map(
            (lead) =>
              `<li><strong>${esc(lead.name || "Unknown")}</strong><span>${esc(lead.phone || "")}</span></li>`,
          )
          .join("");
        $("wxCampaignPreview").innerHTML = `<strong>${data.count} eligible recipient${data.count === 1 ? "" : "s"} in this batch</strong>${data.recentDuplicatesExcluded ? "<small>Same-template sends from the last 24 hours are excluded.</small>" : ""}${sample ? `<ul>${sample}</ul>` : "<small>No eligible contacts found.</small>"}`;
        $("wxSendCampaign").disabled = !data.count;
      });
      bind("wxSendCampaign", async () => {
        if (!recipientPreview || recipientPreview.key !== previewKey())
          throw new Error("Preview the current recipient selection first.");
        if (!$("wxCampaignConsent").checked)
          throw new Error("Confirm recipient consent before sending.");
        const values = parameters();
        if (Object.values(values).some((value) => !value))
          throw new Error("Fill every template field.");
        if (
          !s.preview &&
          !window.confirm(
            `Send ${template.name} to ${recipientPreview.count} selected contacts?`,
          )
        )
          return;
        const id = s.active;
        let headerMedia;
        if (headerType) {
          const file = $("wxTemplateHeader")?.files[0];
          if (
            !file ||
            c.mediaType(file) !== headerType ||
            file.size > (headerType === "image" ? 5 : 16) * 1024 * 1024
          )
            throw new Error(
              "Choose a valid header attachment within the file-size limit.",
            );
          if (!s.preview) {
            const uploaded = await request(
              `${chatPath(id)}/template-media?${new URLSearchParams({ filename: file.name })}`,
              {
                method: "POST",
                headers: { "Content-Type": file.type },
                body: file,
              },
            );
            headerMedia = uploaded.id;
          }
        }
        $("wxCampaignPreview").innerHTML = `<div id="wxCampaignProgress" class="wa-campaign-progress" role="progressbar" aria-label="Template sending progress" aria-valuemin="0" aria-valuemax="${recipientPreview.count}" aria-valuenow="0"><div class="wa-campaign-progress__head"><strong>Sending template…</strong><b id="wxCampaignProgressCount">0 / ${recipientPreview.count}</b></div><div class="wa-campaign-progress__track"><span id="wxCampaignProgressBar"></span></div><small id="wxCampaignProgressMeta">Starting secure WhatsApp delivery…</small></div>`;
        $("wxSendCampaign").disabled = true;
        const updateProgress = (event) => {
          const result = event.result || {};
          const total = Number(event.total ?? result.requested) || recipientPreview.count;
          const completed = Number(event.completed ?? result.requested) || 0;
          const sent = Number(event.sent ?? result.sent) || 0;
          const failed = Number(event.failed ?? result.failed) || 0;
          const percent = total ? Math.round((completed / total) * 100) : 100;
          const progress = $("wxCampaignProgress");
          if (!progress) return;
          progress.setAttribute("aria-valuemax", String(total));
          progress.setAttribute("aria-valuenow", String(completed));
          $("wxCampaignProgressBar").style.width = `${Math.min(percent, 100)}%`;
          $("wxCampaignProgressCount").textContent = `${completed} / ${total}`;
          $("wxCampaignProgressMeta").textContent = `${percent}% complete · ${sent} sent · ${failed} failed`;
        };
        const bodyParameters = fields
          .filter((field) => field.key.startsWith("BODY:"))
          .map((field) => values[field.key]);
        const headerTextParameters = fields
          .filter((field) => field.key.startsWith("HEADER:"))
          .map((field) => values[field.key]);
        const buttonParameters = fields
          .filter((field) => field.key.startsWith("BUTTON:"))
          .map((field) => ({
            index: field.key.split(":")[1],
            text: values[field.key],
          }));
        const payload = {
          ...campaignSettings(),
          mode: "template",
          languageCode: template.language,
          headerType,
          headerMedia,
          bodyParameters,
          headerTextParameters,
          buttonParameters,
          consentConfirmed: true,
        };
        let result;
        try {
          if (s.preview) {
            result = {
              requested: recipientPreview.count,
              sent: recipientPreview.count,
              failed: 0,
            };
            updateProgress({ type: "complete", result });
          } else {
            const response = await request("/api/leads/broadcast/send", {
              method: "POST",
              headers: { Accept: "application/x-ndjson" },
              body: JSON.stringify(payload),
              responseType: "stream",
              signal: AbortSignal.timeout(5 * 60 * 1000),
            });
            result = await readCampaignProgress(response, updateProgress);
          }
        } catch (error) {
          recipientPreview = null;
          if ($("wxCampaignProgressMeta"))
            $("wxCampaignProgressMeta").textContent =
              "Progress interrupted. Preview again before retrying.";
          throw error;
        }
        $("wxCampaignPreview").innerHTML = `<strong>Campaign complete</strong><small>${result.sent} sent · ${result.failed} failed · ${result.requested} selected</small>${result.failures?.length ? `<details><summary>View first failures</summary><ul>${result.failures.map((failure) => `<li>${esc(failure.phone)} · ${esc(failure.error)}</li>`).join("")}</ul></details>` : ""}`;
        $("wxSendCampaign").remove();
        window.dispatchEvent(
          new CustomEvent("rxcrm:marketing-updated", {
            detail: { campaignId: result.campaignId || "" },
          }),
        );
        notify(`${result.sent} template messages sent.`);
      });
      return;
    }
    bind("wxSendTemplate", async () => {
      const values = parameters();
      if (Object.values(values).some((v) => !v))
        throw new Error("Fill every template field.");
      if (
        !current().lastInboundAt &&
        !current().consentRecordedAt &&
        !$("wxTemplateConsent").checked
      )
        throw new Error("Confirm customer consent before sending.");
      const id = s.active,
        consent = $("wxTemplateConsent").checked,
        previewText = preview();
      let headerMediaId;
      if (headerType) {
        const file = $("wxTemplateHeader")?.files[0];
        if (
          !file ||
          c.mediaType(file) !== headerType ||
          file.size > (headerType === "image" ? 5 : 16) * 1024 * 1024
        )
          throw new Error(
            "Choose a valid header attachment within the file-size limit.",
          );
        if (!s.preview) {
          const uploaded = await request(
            `${chatPath(id)}/template-media?${new URLSearchParams({ filename: file.name })}`,
            {
              method: "POST",
              headers: { "Content-Type": file.type },
              body: file,
            },
          );
          headerMediaId = uploaded.id;
        }
      }
      if (s.active !== id) return;
      await sendStructured({
        type: "template",
        templateId: template.id,
        name: template.name,
        parameters: values,
        consent,
        headerMediaId,
        previewText,
      });
      closeDrawer();
    });
  }
  async function reaction(message, emoji) {
    if (!requireAdvanced()) return;
    if (s.preview) {
      message.reactions = {
        ...(message.reactions || {}),
        business: { emoji, timestamp: new Date().toISOString() },
      };
      renderMessages(true);
    } else
      await sendStructured({ type: "reaction", messageId: message.id, emoji });
    closeDrawer();
  }
  function contact() {
    form(
      "Send contact",
      `<label>Name<input id="wxCardName" maxlength="100"></label><label>Phone with country code<input id="wxCardPhone" type="tel" placeholder="+91…"></label>${button("wxSendCard", s.preview ? "Send to preview" : "Send contact")}`,
    );
    bind("wxSendCard", async () => {
      const name = $("wxCardName").value.trim(),
        phone = $("wxCardPhone").value.replace(/[\s()+-]/g, "");
      if (!name || !/^[1-9]\d{6,14}$/.test(phone))
        throw new Error("Enter a name and full international phone number.");
      await sendStructured({ type: "contacts", name, phone });
      closeDrawer();
    });
  }
  function location() {
    form(
      "Send location",
      `<label>Place name<input id="wxPlace" maxlength="100"></label><label>Address<input id="wxAddress" maxlength="250"></label><label>Latitude<input id="wxLatitude" type="number" min="-90" max="90" step="any"></label><label>Longitude<input id="wxLongitude" type="number" min="-180" max="180" step="any"></label>${button("wxMyLocation", "Use my current location")}${button("wxSendLocation", s.preview ? "Send to preview" : "Send location")}<p class="wa-muted">Sends a fixed location, not continuous live tracking.</p>`,
    );
    bind(
      "wxMyLocation",
      () =>
        new Promise((resolve, reject) => {
          if (!navigator.geolocation)
            return reject(new Error("Location is unavailable."));
          navigator.geolocation.getCurrentPosition(
            (p) => {
              if ($("wxLatitude")) {
                $("wxLatitude").value = p.coords.latitude;
                $("wxLongitude").value = p.coords.longitude;
              }
              resolve();
            },
            (e) => reject(new Error(e.message)),
            { timeout: 15000 },
          );
        }),
    );
    bind("wxSendLocation", async () => {
      const latitude = $("wxLatitude").value,
        longitude = $("wxLongitude").value;
      if (
        !latitude ||
        !longitude ||
        !Number.isFinite(Number(latitude)) ||
        !Number.isFinite(Number(longitude)) ||
        Math.abs(Number(latitude)) > 90 ||
        Math.abs(Number(longitude)) > 180
      )
        throw new Error("Enter valid coordinates.");
      await sendStructured({
        type: "location",
        latitude,
        longitude,
        name: $("wxPlace").value,
        address: $("wxAddress").value,
      });
      closeDrawer();
    });
  }
  async function catalogue() {
    if (!requireAdvanced()) return;
    form(
      "Product catalogue",
      '<p id="wxCatalogueStatus">Loading catalogue…</p><div id="wxProducts"></div>',
    );
    let after = null;
    const products = [];
    async function load() {
      const data = s.preview
        ? {
            configured: true,
            products: c.s.samples.map((p, i) => ({
              id: "sample-" + i,
              name: p.name,
              retailer_id: "Sample item",
            })),
          }
        : await request(
            "/api/chats/catalogue" +
              (after ? "?after=" + encodeURIComponent(after) : ""),
          );
      if (!$("wxProducts")) return;
      products.push(...data.products);
      after = data.nextCursor;
      $("wxCatalogueStatus").textContent = data.configured
        ? s.preview
          ? "Sample catalogue · preview only"
          : "Connected Meta catalogue"
        : data.reason;
      $("wxProducts").innerHTML =
        products
          .map(
            (p, i) =>
              `<article class="wa-quick-card"><strong>${esc(p.name)}</strong><p>${esc([p.price, p.currency, p.availability].filter(Boolean).join(" · "))}</p><small>${esc(p.retailer_id || "")}</small><button type="button" data-send-product="${i}">Share product</button></article>`,
          )
          .join("") +
        (after ? button("wxMoreProducts", "Load more products") : "");
      document.querySelectorAll("[data-send-product]").forEach(
        (b) =>
          (b.onclick = async () => {
            const p = products[Number(b.dataset.sendProduct)];
            b.disabled = true;
            try {
              await sendStructured({
                type: "product",
                productId: p.id,
                name: p.name,
                previewText: p.name,
              });
              notify(
                s.preview
                  ? "Product added to preview"
                  : "Product submitted to WhatsApp",
              );
            } catch (e) {
              notify(e.message);
            } finally {
              b.disabled = false;
            }
          }),
      );
      bind("wxMoreProducts", load);
    }
    try {
      await load();
    } catch (e) {
      if ($("wxCatalogueStatus"))
        $("wxCatalogueStatus").textContent = e.message;
    }
  }
  async function forward() {
    if (!x.selected.size || !requireAdvanced()) return;
    const source = s.active,
      selected = [...x.selected],
      messages = (x.search?.messages || s.messages).filter((m) =>
        selected.includes(m.id),
      );
    form(
      "Forward messages",
      `<p>${selected.length} selected messages</p><label>Recipient<select id="wxForwardTo">${s.chats
        .filter((l) => l.id !== source)
        .map(
          (l) =>
            `<option value="${esc(l.id)}">${esc(l.name || l.phone)}</option>`,
        )
        .join(
          "",
        )}</select></label><label class="wa-check"><input id="wxForwardConsent" type="checkbox">I have permission to share this content with this recipient</label><p class="wa-muted">Review the recipient before sending. Messages are sent separately.</p>${button("wxConfirmForward", s.preview ? "Forward in preview" : "Forward selected messages")}`,
    );
    bind("wxConfirmForward", async () => {
      const target = $("wxForwardTo").value;
      if (!target || !$("wxForwardConsent").checked)
        throw new Error(
          "Choose a recipient and confirm you can share this content.",
        );
      if (s.preview) {
        const rows = s.previewThreads.get(target) || [];
        rows.push(
          ...messages.map((m) => ({
            ...m,
            id: crypto.randomUUID(),
            role: "sales",
            status: "preview",
            context: null,
            timestamp: new Date().toISOString(),
          })),
        );
        s.previewThreads.set(target, rows);
      } else {
        const result = await post(`${chatPath(source)}/forward`, {
          targetId: target,
          messageIds: selected,
          clientMessageId: crypto.randomUUID(),
          permission: true,
        });
        if (result.failed)
          throw new Error(
            `${result.sent} messages submitted. ${result.failed} Refresh both chats before trying again.`,
          );
      }
      x.selected.clear();
      closeDrawer();
      renderMessages();
      notify(
        s.preview ? "Forwarded in preview" : "Selected messages submitted",
      );
    });
  }
  async function team() {
    if (!current() || !requireAdvanced()) return;
    const id = s.active,
      lead = current();
    form("Team & internal notes", '<p id="wxTeamStatus">Loading…</p>');
    const data = s.preview
      ? { notes: lead.demoNotes || [], presence: [] }
      : await request(`${chatPath(id)}/team`);
    if (s.active !== id || !$("wxTeamStatus")) return;
    form(
      "Team & internal notes",
      `<p>${data.presence?.length ? esc(data.presence.map((p) => p.agent).join(", ")) + " is replying…" : "No other agent is replying."}</p><label>Assigned agent<select id="wxAssignee" ${x.role === "admin" ? "" : "disabled"}>${x.team.map((a) => `<option value="${esc(a)}">${esc(a)}</option>`).join("")}</select></label>${x.role === "admin" ? button("wxAssign", "Assign contact") : ""}<label>Internal note<textarea id="wxNote" rows="3" maxlength="4000" placeholder="Visible to your team, not the customer"></textarea></label>${button("wxSaveNote", "Add internal note")}<div>${data.notes.map((n) => `<article class="wa-note"><strong>${esc(n.agent)}</strong><small>${esc(dateTime(n.createdAt))}</small><p>${esc(n.text)}</p></article>`).join("") || "<p>No internal notes yet.</p>"}</div>`,
    );
    $("wxAssignee").value = lead.assignedTo;
    bind("wxAssign", async () => {
      const assignedTo = $("wxAssignee").value;
      if (s.preview) lead.assignedTo = assignedTo;
      else await post(`${chatPath(id)}/assign`, { assignedTo });
      renderHeader();
      notify("Contact assigned");
    });
    bind("wxSaveNote", async () => {
      const text = $("wxNote").value.trim();
      if (!text) throw new Error("Write a note first.");
      if (s.preview) {
        lead.demoNotes ||= [];
        lead.demoNotes.unshift({
          text,
          agent: "You",
          createdAt: new Date().toISOString(),
        });
      } else
        await post(`${chatPath(id)}/notes`, { text, id: crypto.randomUUID() });
      await team();
    });
  }
  async function toggleAI() {
    const lead = current();
    if (!lead || !requireAdvanced()) return;
    const enabled = lead.aiEnabled === false;
    if (s.preview) lead.aiEnabled = enabled;
    else await post(`${chatPath(s.active)}/ai`, { enabled });
    lead.aiEnabled = enabled;
    renderHeader();
    c.showDetails();
    notify(enabled ? "AI replies enabled" : "Manual handling enabled");
  }
  async function suggest() {
    if (!current() || !requireAdvanced()) return;
    const id = s.active;
    form(
      "Suggested reply",
      '<p id="wxSuggestionStatus">Preparing a reply…</p>',
    );
    const data = s.preview
      ? {
          text: "Thank you for sharing your requirement. Could you confirm the size, quantity and delivery city so our team can help with the next steps?",
        }
      : await post(`${chatPath(id)}/suggest`, {});
    if (s.active !== id || !$("wxSuggestionStatus")) return;
    form(
      "Review suggested reply",
      `<label>Suggested message<textarea id="wxSuggestedText" rows="7" maxlength="4096">${esc(data.text)}</textarea></label>${button("wxUseSuggestion", "Add to draft")}<p class="wa-muted">Review the wording and details before pressing Send in the chat.</p>`,
    );
    bind("wxUseSuggestion", () => {
      insertDraft($("wxSuggestedText").value);
      closeDrawer();
    });
  }
  async function sequence() {
    if (!current() || !requireAdvanced()) return;
    const id = s.active,
      lead = current();
    form("Sequence", '<p id="wxSequenceLoading">Loading sequence…</p>');
    const data = s.preview
      ? {
          enabled: true,
          plan: {
            name: "Visual Aid Engagement",
            steps: [
              {
                type: "text",
                delayHours: 4,
                text: "Would you like help choosing a finish for your visual aid?",
                caption: "",
                media: "",
              },
            ],
          },
        }
      : await request("/api/chats/sequence-settings");
    if (s.active !== id || !$("wxSequenceLoading")) return;
    let steps = structuredClone(lead.sequencePlan || data.plan?.steps || []);
    form(
      "Sequence",
      `<div class="wa-sequence-summary"><strong>${esc(lead.sequenceStatus || "Not started")}</strong><span>Step ${Number(lead.sequenceStepIndex || 0)} of ${steps.length}</span><span>Next: ${esc(dateTime(lead.nextSequenceAt))}</span><span id="wxSequenceCountdown"></span>${lead.sequenceStopReason ? `<small>${esc(lead.sequenceStopReason.replaceAll("_", " "))}</small>` : ""}</div>${!data.enabled ? "<p>Automatic sequences are disabled on the server.</p>" : ""}<div class="wa-inline-actions">${button("wxPauseSequence", "Pause")}${button("wxResumeSequence", "Resume")}${button("wxStopSequence", "Stop")}</div><div id="wxSteps"></div>${button("wxAddStep", "Add step")}${button("wxStartSequence", s.preview ? "Start sample sequence" : "Start this sequence")}${x.role === "admin" ? button("wxDefaultSequence", "Save as default plan") : ""}<p class="wa-muted">Times are hours from the start. Starting or resuming enables AI handling. A message already submitted cannot be recalled by Pause. Edits apply when you start a new sequence.</p>`,
    );
    const render = () => {
      $("wxSteps").innerHTML = steps
        .map(
          (st, i) =>
            `<article class="wa-sequence-step"><strong>Step ${i + 1}</strong><label>Hours from start<input data-step-hour="${i}" type="number" min="0.05" max="23.99" step="0.05" value="${st.delayHours}"></label><label>Message type<select data-step-type="${i}"><option value="text" ${st.type === "text" ? "selected" : ""}>Text</option><option value="video" ${st.type === "video" ? "selected" : ""}>Video</option><option value="image" ${st.type === "image" ? "selected" : ""}>Image</option></select></label>${st.type !== "text" ? `<label>WhatsApp media ID or HTTPS link<input data-step-media="${i}" value="${esc(st.media || "")}"></label>` : ""}<label>${st.type === "text" ? "Message" : "Caption"}<textarea data-step-text="${i}" rows="3">${esc(st.type === "text" ? st.text || "" : st.caption || "")}</textarea></label><button type="button" data-remove-step="${i}">Remove step</button></article>`,
        )
        .join("");
      document
        .querySelectorAll("[data-step-hour]")
        .forEach(
          (e) =>
            (e.oninput = () =>
              (steps[Number(e.dataset.stepHour)].delayHours = Number(e.value))),
        );
      document.querySelectorAll("[data-step-text]").forEach(
        (e) =>
          (e.oninput = () => {
            const st = steps[Number(e.dataset.stepText)];
            st[st.type === "text" ? "text" : "caption"] = e.value;
          }),
      );
      document
        .querySelectorAll("[data-step-media]")
        .forEach(
          (e) =>
            (e.oninput = () =>
              (steps[Number(e.dataset.stepMedia)].media = e.value)),
        );
      document.querySelectorAll("[data-step-type]").forEach(
        (e) =>
          (e.onchange = () => {
            steps[Number(e.dataset.stepType)].type = e.value;
            render();
          }),
      );
      document.querySelectorAll("[data-remove-step]").forEach(
        (e) =>
          (e.onclick = () => {
            steps.splice(Number(e.dataset.removeStep), 1);
            render();
          }),
      );
    };
    render();
    bind("wxAddStep", () => {
      if (steps.length >= 10) throw new Error("Maximum 10 steps.");
      steps.push({
        type: "text",
        delayHours: Math.min(23.9, (steps.at(-1)?.delayHours || 0) + 1),
        text: "",
        caption: "",
        media: "",
      });
      render();
    });
    const control = async (action) => {
      if (s.preview) {
        if (action === "start") {
          let prev = 0;
          for (const st of steps) {
            if (
              !Number.isFinite(st.delayHours) ||
              st.delayHours <= prev ||
              st.delayHours >= 24 ||
              !(st.text || st.media)
            )
              throw new Error(
                "Use increasing times below 24 hours and fill each message.",
              );
            prev = st.delayHours;
          }
          Object.assign(lead, {
            sequenceStatus: "active",
            sequencePlan: steps,
            sequenceStepIndex: 0,
            nextSequenceAt: new Date(
              Date.now() + steps[0].delayHours * 3600000,
            ).toISOString(),
            aiEnabled: true,
          });
        } else {
          lead.sequenceStatus = {
            pause: "paused",
            resume: "active",
            stop: "stopped",
          }[action];
          if (action === "stop") lead.nextSequenceAt = null;
        }
      } else {
        const result = await post(`${chatPath(id)}/sequence`, {
          action,
          steps,
        });
        Object.assign(lead, result.lead);
      }
      renderHeader();
      await sequence();
    };
    bind("wxStartSequence", () => control("start"));
    bind("wxPauseSequence", () => control("pause"));
    bind("wxResumeSequence", () => control("resume"));
    bind("wxStopSequence", () => control("stop"));
    bind("wxDefaultSequence", async () => {
      if (!s.preview)
        await post("/api/chats/sequence-settings", {
          steps,
          name: "Visual Aid Engagement",
        });
      notify(s.preview ? "Preview plan only" : "Default plan saved");
    });
    $("wxPauseSequence").disabled = lead.sequenceStatus !== "active";
    $("wxResumeSequence").disabled = lead.sequenceStatus !== "paused";
    $("wxStopSequence").disabled = !["active", "paused"].includes(
      lead.sequenceStatus,
    );
    $("wxStartSequence").disabled =
      lead.sequenceStatus === "active" || !data.enabled;
    const tick = () => {
      if (!$("wxSequenceCountdown")) return;
      const seconds = Math.max(
        0,
        Math.ceil((Date.parse(lead.nextSequenceAt) - Date.now()) / 1000),
      );
      $("wxSequenceCountdown").textContent =
        lead.sequenceStatus === "active" && Number.isFinite(seconds)
          ? `Next check in ${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m ${seconds % 60}s${s.preview ? " · Sample only" : ""}`
          : "";
    };
    tick();
    const timer = setInterval(() => {
      if (!$("wxSequenceCountdown") || s.active !== id) clearInterval(timer);
      else tick();
    }, 1000);
  }
  function capabilities() {
    const items = x.capabilities || {
      calling: {
        reason:
          "Voice calling requires an eligible business account and a calling integration. Video support needs separate verification.",
      },
      groups: {
        reason:
          "Groups need eligibility verification. Communities and Channels are not connected.",
      },
      status: {
        reason: "Status stories, polls and events have not been integrated.",
      },
      presence: {
        reason:
          "Customer photo, About, last seen, online and incoming typing are not supplied by this integration.",
      },
      editing: {
        reason:
          "Edit sent messages and Delete for everyone have not been verified for this integration.",
      },
      historySync: {
        reason:
          "Linked devices and phone history need eligible onboarding/coexistence setup.",
      },
    };
    form(
      "WhatsApp feature availability",
      Object.entries(items)
        .map(
          ([name, item]) =>
            `<article class="wa-quick-card"><strong>${esc({ calling: "WhatsApp calls", groups: "Groups, Communities & Channels", status: "Status, polls & events", presence: "Customer profile & presence", editing: "Edit / delete for everyone", historySync: "Linked devices & history sync" }[name] || name)}</strong><p>${esc(item.reason)}</p></article>`,
        )
        .join("") +
        '<p class="wa-muted">These features are not active in this CRM. The normal phone button opens your device dialer. Business typing and Block/Unblock use separate supported endpoints.</p>',
    );
  }
  function block() {
    if (!current() || !requireAdvanced()) return;
    const lead = current(),
      blocked = !lead.whatsappBlocked;
    form(
      blocked ? "Block contact" : "Unblock contact",
      `<p>${esc(lead.name || lead.phone)}</p><p>${blocked ? "Block this contact on WhatsApp and pause automation." : "Remove the WhatsApp block. AI stays manual, and an existing customer opt-out stays in effect."}</p>${button("wxConfirmBlock", s.preview ? "Apply in preview" : blocked ? "Block on WhatsApp" : "Unblock on WhatsApp")}`,
    );
    bind("wxConfirmBlock", async () => {
      if (!s.preview) await post(`${chatPath(s.active)}/block`, { blocked });
      lead.whatsappBlocked = blocked;
      if (blocked) lead.aiEnabled = false;
      renderHeader();
      closeDrawer();
      notify(
        s.preview
          ? "Preview contact updated"
          : blocked
            ? "Blocked on WhatsApp"
            : "Unblocked on WhatsApp",
      );
    });
  }
  function messageContent(m) {
    if (m.type === "order" && m.order)
      return `<div class="wa-order"><strong>Customer order</strong>${(m.order.product_items || []).map((item) => `<p>${esc(item.product_retailer_id)} · ${esc(item.quantity)} × ${esc(item.item_price)} ${esc(item.currency)}</p>`).join("")}<small>${esc(m.orderStatus || "Received")}</small></div>`;
    if (m.product)
      return `<div class="wa-product-message"><strong>${esc(m.product.name)}</strong><small>Product catalogue</small></div>`;
    return "";
  }
  function order(message) {
    form(
      "Order status",
      `<p>${esc((message.order.product_items || []).map((p) => p.product_retailer_id + " × " + p.quantity).join(", "))}</p><label>Status<select id="wxOrderStatus"><option value="received">Received</option><option value="confirmed">Confirmed</option><option value="fulfilled">Fulfilled</option><option value="cancelled">Cancelled</option></select></label>${button("wxSaveOrder", "Save order status")}<p class="wa-muted">This updates the CRM order record. Send a message separately to notify the customer.</p>`,
    );
    $("wxOrderStatus").value = message.orderStatus || "received";
    bind("wxSaveOrder", async () => {
      const status = $("wxOrderStatus").value;
      if (!s.preview)
        await post(
          `${chatPath(s.active)}/orders/${encodeURIComponent(message.id)}`,
          { status },
        );
      message.orderStatus = status;
      renderMessages(true);
      closeDrawer();
    });
  }
  return {
    newChat,
    quickReplies,
    expandQuickReply,
    templates,
    reaction,
    contact,
    location,
    catalogue,
    forward,
    team,
    toggleAI,
    suggest,
    sequence,
    capabilities,
    block,
    messageContent,
    order,
  };
}
