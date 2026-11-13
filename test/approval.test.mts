// node --test --experimental-strip-types. A .mts file, so the n8n lint rules for
// code that ships (which match **/*.ts) leave alone a test that is never published.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
	callbackProblem,
	decision,
	list,
	poll,
	requestBody,
	type Approval,
} from '../nodes/Deliverd/approval.ts';

const now = Date.parse('2026-10-15T12:00:00Z');

test('approvers take commas or new lines', () => {
	assert.deepEqual(list('a@x.com, Support leads\n b@x.com\n'), ['a@x.com', 'Support leads', 'b@x.com']);
	assert.deepEqual(list(undefined), []);
});

test('the request body carries what was set and nothing that was not', () => {
	assert.deepEqual(requestBody('Refund €120?', {}, {}, now), { title: 'Refund €120?' });
	assert.deepEqual(
		requestBody(
			' Refund €120? ',
			{
				description: 'Customer was double-charged',
				approvers: 'finance@example.com, Support leads',
				risk: 'high',
				input: '{"amount": 120, "currency": "EUR"}',
				editableFields: 'amount',
				externalId: 'order-4411',
				flowId: ' 7d1c0a52-3f9e-4b8a-9c41-2b6f0e8d9a10 ',
				expiresInMinutes: 30,
			},
			{ callbackUrl: 'https://n8n.example.com/webhook-waiting/7?signature=x', metadata: { n8n: {} } },
			now,
		),
		{
			title: 'Refund €120?',
			description: 'Customer was double-charged',
			approvers: ['finance@example.com', 'Support leads'],
			risk: 'high',
			input: { amount: 120, currency: 'EUR' },
			editableFields: ['amount'],
			externalId: 'order-4411',
			flowId: '7d1c0a52-3f9e-4b8a-9c41-2b6f0e8d9a10',
			expiresAt: '2026-10-15T12:30:00.000Z',
			callbackUrl: 'https://n8n.example.com/webhook-waiting/7?signature=x',
			metadata: { n8n: {} },
		},
	);
	// From an expression, n8n hands JSON over as an object.
	assert.deepEqual(requestBody('x', { input: { a: 1 } }, {}, now).input, { a: 1 });
});

test('a mistake in the settings raises no request', () => {
	assert.throws(() => requestBody('  ', {}), /Title/);
	assert.throws(() => requestBody('x', { input: '{nope' }), /JSON object/);
	assert.throws(() => requestBody('x', { input: '[1,2]' }), /JSON object/);
	assert.throws(() => requestBody('x', { input: '{"a":1}', editableFields: 'b' }), /"b"/);
	assert.throws(() => requestBody('x', { editableFields: 'a' }), /"a"/);
	assert.throws(() => requestBody('x', { expiresInMinutes: 0 }), /minutes/);
	assert.throws(() => requestBody('x', { flowId: 'release-4.2' }), /Flow ID/);
});

test('the callback method refuses an n8n Deliverd cannot reach, and says what to do', () => {
	assert.equal(callbackProblem('https://n8n.example.com/webhook-waiting/12?signature=abc'), undefined);
	for (const url of [
		'http://n8n.example.com/webhook-waiting/12',
		'https://localhost:5678/webhook-waiting/12',
		'https://127.0.0.1/webhook-waiting/12',
		'https://192.168.1.20/webhook-waiting/12',
		'https://10.0.0.4/webhook-waiting/12',
		'https://172.20.0.2/webhook-waiting/12',
		'https://n8n.local/webhook-waiting/12',
	]) {
		assert.match(callbackProblem(url) ?? '', /WEBHOOK_URL.*Poll/, url);
	}
	assert.ok(callbackProblem(undefined));
	assert.ok(callbackProblem('not a url'));
});

const approval: Approval = {
	id: 'apr_1',
	status: 'approved',
	url: 'https://deliverd.dev/a/apr_1',
	title: 'Refund €120?',
	decidedBy: 'Ana',
	decidedAt: '2026-10-15T12:05:00Z',
	note: null,
	approvedInput: { amount: 100 },
};

test('the output puts approved on top, and run-with values only on an approval', () => {
	assert.equal(decision(approval).approved, true);
	assert.deepEqual(decision(approval).approvedInput, { amount: 100 });
	const no = decision({ ...approval, status: 'rejected' });
	assert.equal(no.approved, false);
	assert.equal(no.approvedInput, null);
	assert.equal(decision({ ...approval, status: 'changes_requested' }).approved, false);
});

test('poll waits until the request settles', async () => {
	const states = [{ ...approval, status: 'pending' }, { ...approval, status: 'pending' }, approval];
	let slept = 0;
	const result = await poll(
		async () => states.shift()!,
		Infinity,
		async () => void slept++,
	);
	assert.equal(result.approval.status, 'approved');
	assert.equal(result.timedOut, false);
	assert.equal(slept, 2);
});

test('poll gives up at the deadline with the request as it stands', async () => {
	const result = await poll(
		async () => ({ ...approval, status: 'pending' }),
		0,
		async () => assert.fail('must not sleep past the deadline'),
	);
	assert.equal(result.timedOut, true);
	assert.equal(result.approval.status, 'pending');
});

test('package.json names the files the build produces', () => {
	const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
	assert.ok(pkg.keywords.includes('n8n-community-node-package'), 'n8n only lists packages with this keyword');
	assert.deepEqual(pkg.n8n.nodes, ['dist/nodes/Deliverd/Deliverd.node.js']);
	assert.deepEqual(pkg.n8n.credentials, ['dist/credentials/DeliverdApi.credentials.js']);
	assert.deepEqual(Object.keys(pkg.dependencies ?? {}), [], 'a verified community node has no runtime dependencies');
	const codex = JSON.parse(readFileSync(new URL('../nodes/Deliverd/Deliverd.node.json', import.meta.url), 'utf8'));
	assert.equal(codex.node, `${pkg.name}.deliverd`);
});
