# Phase 21 API — attendance and reporting lines

Task 1. Later tasks add their routes here.

## GET /staff/without-reporting-line

Who: CEO only.

Request: none.

Response: `200` array of staff who must have a reporting line and do not (call agents, field agents, Team Leads, Managers, Finance). Deactivated accounts are left out. The CEO is never in this list. Each item is the usual staff view: `id`, `code`, `name`, `email`, `role`, `teamLeadId`, `reportsToId`, `status`, `createdAt`, `deactivatedAt`.

Errors: `403` for anyone who is not the CEO.

Example:

```json
[
  {
    "id": "…",
    "code": "FIN-00012",
    "name": "Sneha Patel",
    "role": "finance",
    "reportsToId": null,
    "status": "active"
  }
]
```

Until a Team Lead, Manager or Finance is given a line, their login-code and device requests are handled by the CEO.

## GET /staff/reporting-tree

Who: CEO and Managers. A Manager sees their own part: themselves and everyone below them. The CEO sees everyone who is not deactivated.

Request: none.

Response: `200`

```json
{ "viewerId": "…", "people": [ { "id": "…", "code": "TL-00003", "role": "team_lead", "reportsToId": "…" } ] }
```

Errors: `403` for a Team Lead, agent or Finance.

## POST /staff/:id/reporting-line

Who: the CEO can move anyone. A Manager can move a call agent or field agent between Team Leads who are both in that Manager's teams. The agent must already be under that Manager.

Request:

```json
{ "reportsToId": "team-lead-id", "reason": "Team reshuffle", "moveOpenWork": true }
```

`reason` is required. `moveOpenWork` defaults to `true`.

The new line must match the role: an agent reports to an active Team Lead, a Team Lead to an active Manager, a Manager or Finance to the CEO, and the CEO to nobody. For an agent, `teamLeadId` is written to the same Team Lead.

When the move changes the agent's Team Lead and `moveOpenWork` is true, this month's target, pending follow-ups, open visit assignments and the businesses they account-manage stay with the person. When `moveOpenWork` is false, those items are reassigned to the previous Team Lead. If that Team Lead already has a target for the month, the agent's target stays on the agent.

Response: `201` the updated staff view.

Errors:

- `400` when the reason is missing, the new line is the wrong role or inactive, or the account is deactivated.
- `403` when a Manager moves someone outside their own teams.
- `404` when the staff id does not exist.

The reason and the before/after line are stored in status history and in the audit log (`staff.reporting_line_moved`).

## POST /staff

Creating staff now requires the same line. An agent may send `teamLeadId` or `reportsToId` (they must be the same person when both are sent). Both columns are stored. A Team Lead sends `reportsToId` of an active Manager. A Manager or Finance sends `reportsToId` of the CEO. A CEO sends neither.

Errors add: `400` "A call agent or field agent must report to an active Team Lead", "A Team Lead must report to an active Manager", "A Manager or Finance must report to the CEO", "The CEO reports to nobody".
