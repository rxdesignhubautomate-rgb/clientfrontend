const esc = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const number = (value) => (Number(value) || 0).toLocaleString("en-IN");

function label(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function when(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function campaignAudience(campaign) {
  const targets = Array.isArray(campaign.targets) ? campaign.targets : [];
  if (targets.length) return targets.map(label).join(" + ");
  return label(campaign.target) || "Selected contacts";
}

function responseRate(campaign) {
  const sent = Number(campaign.sent) || 0;
  const replies = Number(campaign.replies) || 0;
  return sent ? Math.min(100, (replies / sent) * 100) : 0;
}

export function installMarketingWorkspace({ $, crm, openMarketingReplies }) {
  let loading = false;
  let loaded = false;
  let session = "";

  function setSummary(summary = {}) {
    $("marketingCampaigns").textContent = number(summary.campaigns);
    $("marketingSent").textContent = number(summary.sent);
    $("marketingReplies").textContent = number(summary.replies);
    $("marketingFailed").textContent = number(summary.failed);
    $("marketingResponseRate").textContent = `${Number(summary.responseRate) || 0}%`;
  }

  function renderCampaigns(campaigns = []) {
    $("marketingHistoryCount").textContent = `${number(campaigns.length)} ${
      campaigns.length === 1 ? "campaign" : "campaigns"
    }`;
    if (!campaigns.length) {
      $("marketingHistory").innerHTML =
        '<div class="marketing-empty"><strong>No campaign history yet.</strong><span>Your next group marketing template send will be saved here automatically.</span></div>';
      return;
    }
    $("marketingHistory").innerHTML = `
      <div class="marketing-history-head" aria-hidden="true">
        <span>Campaign</span><span>Audience</span><span>Requested</span><span>Sent</span><span>Replies</span><span>Response</span><span>Status</span>
      </div>
      ${campaigns
        .map((campaign) => {
          const rate = responseRate(campaign);
          const status = ["completed", "partial", "failed", "sending"].includes(
            campaign.status,
          )
            ? campaign.status
            : "completed";
          const failureTitle = campaign.failed
            ? `${number(campaign.failed)} failed${campaign.failureSummary?.[0]?.error ? `: ${campaign.failureSummary[0].error}` : ""}`
            : "No failed submissions";
          return `<article class="marketing-history-row">
            <div class="marketing-campaign-name"><strong>${esc(label(campaign.templateName) || "Marketing template")}</strong><small>${esc(when(campaign.startedAt))} · ${esc(campaign.createdBy || "Admin")}</small></div>
            <span>${esc(campaignAudience(campaign))}</span>
            <span class="marketing-history-number">${number(campaign.requested)}</span>
            <span class="marketing-history-number" title="${esc(failureTitle)}">${number(campaign.sent)}</span>
            <span class="marketing-history-number">${number(campaign.replies)}</span>
            <span class="marketing-response"><b>${rate.toFixed(1)}%</b><span class="marketing-response-bar" aria-hidden="true"><i style="--response-width:${rate.toFixed(1)}%"></i></span></span>
            <span class="marketing-status marketing-status--${status}">${esc(status)}</span>
          </article>`;
        })
        .join("")}`;
  }

  function renderError(error) {
    const adminMessage =
      error?.status === 403
        ? "Marketing history is available to the Admin account."
        : error?.status === 404
          ? "Deploy the updated backend to start storing campaign history."
          : error?.message || "Marketing history could not be loaded.";
    $("marketingHistory").innerHTML = `<div class="marketing-error"><strong>Could not load marketing data</strong><span>${esc(adminMessage)}</span></div>`;
    $("marketingUpdatedAt").textContent = "Data unavailable";
  }

  async function refresh(force = false) {
    if (loading || (loaded && !force)) return;
    if (!crm.snapshot().connected) {
      setSummary();
      $("marketingHistory").innerHTML =
        '<div class="marketing-empty"><strong>Sign in to view marketing history.</strong><span>Campaign data is stored securely in the CRM backend.</span></div>';
      $("marketingUpdatedAt").textContent = "Waiting for CRM login";
      return;
    }
    loading = true;
    $("marketingRefreshBtn").disabled = true;
    $("marketingRefreshBtn").textContent = "Refreshing…";
    $("marketingHistory").closest(".marketing-history-card")?.classList.add("is-loading");
    if (!loaded)
      $("marketingHistory").innerHTML =
        '<div class="marketing-loading"><strong>Loading marketing history…</strong></div>';
    try {
      const data = await crm.request("/api/leads/broadcast/history?limit=100");
      setSummary(data.summary);
      renderCampaigns(data.campaigns);
      $("marketingUpdatedAt").textContent = `Updated ${new Date().toLocaleTimeString(
        "en-IN",
        { hour: "2-digit", minute: "2-digit" },
      )}`;
      loaded = true;
    } catch (error) {
      renderError(error);
    } finally {
      loading = false;
      $("marketingRefreshBtn").disabled = false;
      $("marketingRefreshBtn").textContent = "Refresh data";
      $("marketingHistory").closest(".marketing-history-card")?.classList.remove("is-loading");
    }
  }

  function sessionChanged(snapshot = crm.snapshot()) {
    const nextSession = snapshot.connected
      ? `${snapshot.role || "user"}:${snapshot.device || "device"}`
      : "";
    if (nextSession !== session) {
      session = nextSession;
      loaded = false;
      setSummary();
    }
  }

  $("marketingRefreshBtn").onclick = () => refresh(true);
  $("marketingRepliesBtn").onclick = openMarketingReplies;
  window.addEventListener("rxcrm:marketing-updated", () => {
    loaded = false;
    if (document.body.classList.contains("marketing-mode")) refresh(true);
  });

  return { refresh, sessionChanged };
}
