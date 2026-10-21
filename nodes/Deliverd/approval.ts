/*
 * What the node sends to Deliverd and what it hands the next node, kept apart
 * from n8n's runtime so test/approval.test.ts can hold it without one.
 *
 * No local imports, on purpose: the tests load this file directly.
 */

export const SETTLED = ['approved', 'rejected', 'changes_requested', 'expired', 'cancelled'];

export const POLL_SECONDS = 10;

export interface Approval {
	id: string;
	status: string;
	url: string;
	title: string;
	decidedBy: string | null;
	decidedAt: string | null;
	note: string | null;
	approvedInput: Record<string, unknown> | null;
	questions?: Array<{ id: string; question: string; answer: string | null }>;
	[key: string]: unknown;
}

export interface AskOptions {
	description?: string;
	approvers?: string;
	risk?: string;
	input?: string | Record<string, unknown>;
	editableFields?: string;
	externalId?: string;
	/** Minutes until the request expires undecided. */
	expiresInMinutes?: number;
}

/** Emails, ids or team names, one per line or comma-separated. */
export function list(value: string | undefined): string[] {
	return (value ?? '')
		.split(/[\n,]/)
		.map((s) => s.trim())
		.filter(Boolean);
}

/**
 * The body of POST /api/v1/approvals.
 *
 * Checked before anything is sent, so a mistake in the node's settings raises
 * no request that somebody then has to ignore. Throws plain errors; the node
 * wraps them so n8n shows them against the right item.
 */
export function requestBody(
	title: string,
	options: AskOptions,
	extra: { callbackUrl?: string; metadata?: Record<string, unknown> } = {},
	now: number = Date.now(),
): Record<string, unknown> {
	if (!title.trim()) throw new Error('Title is required: what is being asked, as a headline.');

	let input: Record<string, unknown> | undefined;
	if (typeof options.input === 'string' && options.input.trim()) {
		const parsed = parseJson(options.input);
		if (!parsed.ok) throw new Error('Input must be a JSON object, e.g. {"amount": 120}.');
		input = parsed.value as Record<string, unknown>;
	} else if (options.input && typeof options.input === 'object') {
		input = options.input;
	}
	if (input !== undefined && (input === null || typeof input !== 'object' || Array.isArray(input))) {
		throw new Error('Input must be a JSON object, not an array or a single value.');
	}

	const editable = list(options.editableFields);
	for (const field of editable) {
		if (!input || !(field in input)) {
			throw new Error(`Editable Fields names "${field}", which is not a field of Input.`);
		}
	}

	const approvers = list(options.approvers);
	const minutes = options.expiresInMinutes;
	if (minutes !== undefined && !(minutes > 0)) {
		throw new Error('Expires After must be a number of minutes greater than zero.');
	}

	return strip({
		title: title.trim(),
		description: options.description?.trim() || undefined,
		approvers: approvers.length > 0 ? approvers : undefined,
		risk: options.risk || undefined,
		input,
		editableFields: editable.length > 0 ? editable : undefined,
		externalId: options.externalId?.trim() || undefined,
		expiresAt: minutes ? new Date(now + minutes * 60_000).toISOString() : undefined,
		callbackUrl: extra.callbackUrl,
		metadata: extra.metadata,
	});
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
	try {
		return { ok: true, value: JSON.parse(text) };
	} catch {
		return { ok: false };
	}
}

function strip(body: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
}

/**
 * Deliverd only calls back to a public HTTPS address, so an n8n reached at
 * localhost or over plain HTTP can never be woken. Said before the request is
 * raised, with what to do about it, rather than discovered as a wait that
 * never ends.
 */
export function callbackProblem(resumeUrl: string | undefined): string | undefined {
	if (!resumeUrl) return 'n8n did not provide a resume URL for this execution.';
	// Parsed by hand: a community node runs without Node's or the DOM's types.
	const match = /^([a-z][a-z0-9+.-]*):\/\/(?:[^@/?#]*@)?(\[[^\]]+\]|[^:/?#]+)(:\d+)?/i.exec(resumeUrl);
	if (!match) return `n8n's resume URL is not a URL: ${resumeUrl}`;
	const origin = `${match[1]}://${match[2]}${match[3] ?? ''}`;
	if (match[1].toLowerCase() !== 'https') {
		return `Deliverd can only call n8n back over HTTPS, and this n8n's resume URL is ${origin}. Set WEBHOOK_URL to n8n's public HTTPS address, or set Wait Method to Poll.`;
	}
	const host = match[2].toLowerCase();
	if (
		host === 'localhost' ||
		host.endsWith('.localhost') ||
		host.endsWith('.local') ||
		host.endsWith('.internal') ||
		/^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(host) ||
		host === '[::1]'
	) {
		return `Deliverd can only call n8n back at a public address, and this n8n's resume URL is ${origin}. Set WEBHOOK_URL to n8n's public HTTPS address, or set Wait Method to Poll.`;
	}
	return undefined;
}

/**
 * What the next node gets: the request as Deliverd returns it, with
 * `approved` on top so an IF node needs one condition, and the approved
 * values only when there was an approval, so nothing downstream runs with
 * values nobody agreed to.
 */
export function decision(approval: Approval): Record<string, unknown> {
	const approved = approval.status === 'approved';
	return {
		approved,
		...approval,
		approvedInput: approved ? approval.approvedInput : null,
	};
}

/** Poll until the request settles or the deadline passes. */
export async function poll(
	get: () => Promise<Approval>,
	deadline: number,
	sleep: (ms: number) => Promise<void>,
	now: () => number = Date.now,
): Promise<{ approval: Approval; timedOut: boolean }> {
	let approval = await get();
	while (!SETTLED.includes(approval.status)) {
		if (now() >= deadline) return { approval, timedOut: true };
		await sleep(POLL_SECONDS * 1000);
		approval = await get();
	}
	return { approval, timedOut: false };
}
