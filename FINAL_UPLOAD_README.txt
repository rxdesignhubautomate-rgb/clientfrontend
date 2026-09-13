RX CRM Console final upload

UPDATE (followup-interested-merged-v18-20260901):
- Merged Follow Up and Interested into one lower metric tab: Follow Up / Interested.
- Removed the separate Interested metric card to avoid duplicate counting.
- The combined tab uses the existing active-interested Follow Up logic.

UPDATE (new-includes-worked-v17-20260901):
- New metric/card/filter now includes active called/worked leads that have not moved to Follow Up, Quotation, Future, Won or Lost.
- Call statuses Called, Callback, No Answer, Called No Answer and Not Interested keep a New lead in New.
- Legacy Follow Up leads without Interested call status are normalized back to New in the dashboard.
- Call status Converted now moves the lead to Won/Converted status.

UPDATE (followup-interested-v16-20260901):
- Follow Up metric/card/filter now shows only Interested leads.
- Callback-only and normal follow-up leads are no longer included in the Follow Up card unless the lead is Interested.
- Quotation, Future, Won/Converted and Lost remain excluded from Follow Up.

UPDATE (active-hot-v15-20260901):
- Hot metric/card/filter now shows only active Hot leads.
- Hot excludes Won/Converted and Lost leads.
- Open now also excludes leads whose call status is Converted/Won, preventing Open/Won overlap.

UPDATE (quotation-future-v14-20260901):
- Added two lower metric cards: Quotation and Future.
- Lower metric section now has 8 cards total.
- Quotation card/filter shows only Status = Quotation Sent leads.
- Follow Up card/filter no longer includes Quotation Sent or Future leads.
- Added Future to the lead Status filter and lead detail Status dropdown.
- Future clients can be saved without forcing a next-action date.

UPDATE (white-cards-v13-20260901):
- Removed the half-colored glow/tint from the four top cards.
- Cards now stay plain white; only the small status dots carry color.

UPDATE (four-cards-v12-20260901):
- Removed the Win Rate speedometer completely.
- Top performance area now has four matching cards: Total, Won, Lost, Win Rate.
- Win Rate is calculated as Total Won / Total Leads.
- Win Rate displays with two decimal places, for example 2.56%.

UPDATE (simple-speedometer-v11-20260901):
- Simplified the top performance section to only Total, Won and Lost pills.
- Removed Lead Momentum curve/chart and the separate Won Deals gauge/card.
- Kept only Win Rate as a hyper-futuristic speedometer on a white merged background.
- Win Rate remains calculated as Total Won / Total Leads.

UPDATE (winrate-total-v10-20260901):
- Changed Win Rate to calculate Total Won / Total Leads.
- Updated the Win Rate card text to say Won vs total leads.

UPDATE (analytics-gameboard-v9-20260901):
- Reworked the upper scoreboard to match the supplied analytics reference:
  * Lead Momentum chart for Total, Won and Lost across the last six months.
  * Won Deals semicircle gauge for won share of current filtered leads.
  * Win Rate semicircle gauge based on Won / (Won + Lost).
- Total, Won and Lost remain clickable filters. Animations respect reduced motion.

UPDATE (gamification-v8-20260901):
- Moved Total, Won and Lost into a separate scoreboard above all other metrics.
- Added trophy/target styling, entrance and shine animations, hover feedback and
  animated count-up values. Reduced-motion browser preferences are respected.

UPDATE (new-metric-v7-20260901):
- Changed the Fresh Untouched metric card to New.
- The New card counts and filters every lead whose Status is New.

UPDATE (lost-metric-v6-20260901):
- Added a Lost metric card beside Won.
- The card counts Status = Lost and can be clicked to filter lost leads.

UPDATE (remove-contacted-v5-20260901):
- Removed Contacted from the lead Status and Status Filter dropdowns.
- Existing leads returned as Contacted are displayed and saved as New.

UPDATE (call-status-rules-v4-20260901):
- When the lead status is New, call outcomes Not Called, Callback and No Answer
  keep the lead status as New.
- Changing the call outcome to Interested automatically moves status to Follow Up.
- Quick scheduling respects the same New-status rule. All other behavior remains.

UPDATE (remove-smart-actions-20260901):
- Removed the complete "Today's Work & Smart Actions" panel from the dashboard.
- Main metrics, month filtering, lead management and desktop reminders remain.

UPDATE (month-filter-20260831):
- NEW: Lead creation month filter in the Leads toolbar.
  * V2 places it prominently in the Leads header under a LEAD MONTH label.
  * Months are populated automatically from loaded leads, newest first.
  * Selecting a month updates the lead list, dashboard metrics and Smart Actions.
  * All Months remains the default. Desktop reminders continue to cover all
    urgent leads even while a historical month is selected.

This build does not use Vercel API routes.
It connects directly to the live backend:
https://rx-whatsapp-agent.onrender.com

UPDATE (notify-20260718):
- NEW: Desktop notification bell in the top bar.
  * Click the bell to turn on reminders (browser will ask permission once).
  * A red badge shows how many leads need action right now.
  * Alerts fire on: Overdue Follow Up, Due Today, Hot Lead Not Called.
    (Edit the NOTIFY_ISSUES list at the top of app.js to change this.)
  * Alerts respect the logged-in role - a salesperson only gets their own
    leads; admin gets all.
  * No spam: on enable it seeds silently (one summary if items exist), then
    only alerts for NEWLY urgent leads on each 3-min background refresh.
  * When reminders are ON, the app keeps polling even if the CRM tab is in
    the background, so alerts still reach you. When OFF, behaviour is unchanged.
  * State is remembered across reloads; no re-prompt if already allowed.

UPDATE (exclusive-cards):
- Smart Action cards are MUTUALLY EXCLUSIVE. Each lead is counted in exactly
  ONE card (its most urgent). Clicking a card lists exactly those leads.
  Priority order lives in ISSUE_PRIORITY at the top of app.js.
- Removed the duplicate nested newcrm-sales/ folder.

Login, laptop lock and backend request headers are unchanged.

Upload this folder/zip to Vercel:
- public
- package.json
- vercel.json
- FINAL_UPLOAD_README.txt

After upload, hard refresh the browser or open in an incognito window.
Notifications need the site served over HTTPS (Vercel is fine) and permission
allowed in the browser.
