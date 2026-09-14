export async function sendingAvailability(api) {
  try {
    const { data } = await api('/marketing-workspace/capabilities');
    if (!data?.enabled) return { allowed: true, message: '' };
    if (!data.dispatchConfigured) return { allowed: false, message: 'Server sending is disabled. Check CRM_MARKETING_DISPATCH_ENABLED=true and NODE_ENV=production, then deploy.' };
    if (!data.settings?.enabled) return { allowed: false, message: 'Organization sending is paused. An administrator can open Sending settings to enable it.' };
    return { allowed: true, message: '' };
  } catch (error) {
    if (error.status === 404) return { allowed: true, message: '' };
    return { allowed: false, message: 'Sending status could not load. Refresh before starting a batch.' };
  }
}

export function previewActions(status, role) {
  const admin = ['OWNER', 'ADMIN'].includes(role);
  const actions = [];
  if (status === 'DRAFT') actions.push(admin ? ['approve-preview', 'Approve'] : ['submit', 'Request approval']);
  if (status === 'PENDING_APPROVAL' && admin) actions.push(['approve-preview', 'Approve']);
  if (['APPROVED', 'SCHEDULED'].includes(status)) actions.push(['start', 'Start']);
  if (['ACTIVE', 'RUNNING'].includes(status)) actions.push(['pause', 'Pause']);
  if (status === 'PAUSED') actions.push(['resume', 'Resume']);
  if (!['COMPLETED', 'CANCELLED', 'FAILED'].includes(status)) actions.push(['cancel', 'Cancel batch']);
  return actions;
}

// Preserve the server's submission/approval audit trail; approving never starts.
// Read current state so a failed response can be retried without resubmitting.
export async function approvePreview(api, campaignId) {
  const base = `/campaigns/${encodeURIComponent(campaignId)}`;
  let { data: campaign } = await api(base);
  if (campaign.status === 'DRAFT') ({ data: campaign } = await api(`${base}/submit`, { method: 'POST', body: {} }));
  if (campaign.status === 'PENDING_APPROVAL') ({ data: campaign } = await api(`${base}/approve`, { method: 'POST', body: {} }));
  if (campaign.status !== 'APPROVED') throw new Error('This batch changed. Close the preview and refresh.');
  return campaign;
}
