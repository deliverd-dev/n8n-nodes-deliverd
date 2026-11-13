# n8n-nodes-deliverd

Ask a person to approve a step of an [n8n](https://n8n.io) workflow, and wait
for their decision.

The Deliverd node raises a request on [Deliverd](https://deliverd.dev) for the
people you name. They get a notification and decide on a page that works on a
phone, and where you allow it can correct the values you proposed. The workflow
pauses until they do, then carries on with their decision as the node's output.

Typical uses: a refund over a limit, an email an AI agent drafted to a
customer, a record about to be deleted, a payment, a post going out under the
company's name.

## Install

In n8n: **Settings → Community Nodes → Install**, and enter
`n8n-nodes-deliverd`. For a self-hosted queue-mode setup, see
[n8n's guide](https://docs.n8n.io/integrations/community-nodes/installation/).

## Credentials

1. Sign up at [deliverd.dev](https://deliverd.dev). It is free to start.
2. In Deliverd, go to **Agents → Agents**, register an agent called n8n and
   copy its key, with `approvals:write` and `approvals:read`. Use an agent key
   rather than your own API token: nobody can approve a request raised under
   their own name, so a request made with your token could not be approved by
   you.
3. In n8n, add a **Deliverd API** credential and paste the key. Leave the URL
   as `https://deliverd.dev` unless your organisation uses its own address.

## Operations

| Operation | What it does |
|---|---|
| **Ask and Wait** | Raises the request and pauses the workflow until someone decides or it expires. |
| **Ask** | Raises the request and carries on. Use **Get** later, or the request's id, to find the decision. |
| **Get** | Reads a request and its decision. |
| **Cancel** | Withdraws a request nobody has decided yet. |

The output is the request as Deliverd returns it, with `approved` (true or
false) on top, so an **If** node after it needs one condition:
`{{ $json.approved }}`. `status` is `approved`, `rejected`,
`changes_requested`, `expired` or `cancelled`. `decidedBy` and `note` say who
decided and why.

### Let the approver adjust a value

Put the values the next step will use in **Options → Input**, as JSON, and
name the ones the approver may change in **Editable Fields**. When it is
approved, `approvedInput` holds the values to use, with any corrections. It is
`null` unless the request was approved, so nothing downstream can run with
values nobody agreed to.

### Keep it with the rest of the work

Put a project's id in **Options → Flow ID** and the request joins that
project (a flow, in the API), on one timeline with the approvals, reviews and
reports that belong to the same piece of work. The project must be open.

## Waiting

**Callback** (the default) pauses the execution, as n8n's Wait node does, and
Deliverd calls n8n back when someone decides. Nothing runs in the meantime, so
it can wait for days. Deliverd only calls public HTTPS addresses, so n8n has to
be reachable at one: n8n Cloud is, and a self-hosted n8n is when `WEBHOOK_URL`
is set to its public address. The node refuses to start a wait it can see will
never be woken, and says so.

**Poll** keeps the execution running and checks every ten seconds. It works on
a laptop or behind a firewall, but holds the execution open, so it suits waits
of minutes rather than days.

With **Callback**, each execution waits on one request, so the node takes one
item at a time. Put a **Loop Over Items** node in front of it for several.

**Options → Expires After** sets how long the request stays open (a day by
default). When it expires, the node outputs it with `status: "expired"`.

## Also in Deliverd

The same requests can be raised from an AI agent over MCP, from the REST API,
the TypeScript and Python SDKs, the `deliverd` CLI, or a GitHub Actions step.
See [deliverd.dev](https://deliverd.dev).

## Licence

MIT
