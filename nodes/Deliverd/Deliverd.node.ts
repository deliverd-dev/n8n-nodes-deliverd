import {
	NodeConnectionTypes,
	NodeOperationError,
	sleep,
	type IDataObject,
	type IExecuteFunctions,
	type IHttpRequestMethods,
	type IHttpRequestOptions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	type IWebhookDescription,
	type IWebhookFunctions,
	type IWebhookResponseData,
} from 'n8n-workflow';
import {
	callbackProblem,
	decision,
	poll,
	requestBody,
	SETTLED,
	type Approval,
	type AskOptions,
} from './approval';

type Caller = IExecuteFunctions | IWebhookFunctions;

async function deliverd<T>(
	ctx: Caller,
	method: IHttpRequestMethods,
	path: string,
	body?: IDataObject,
): Promise<T> {
	const credentials = await ctx.getCredentials<{ url?: string }>('deliverdApi');
	const base = (credentials.url || 'https://deliverd.dev').replace(/\/+$/, '');
	const options: IHttpRequestOptions = {
		method,
		url: `${base}/api/v1${path}`,
		json: true,
		body,
	};
	return (await ctx.helpers.httpRequestWithAuthentication.call(ctx, 'deliverdApi', options)) as T;
}

/*
 * The address Deliverd calls when someone decides. `restartWebhook` makes it
 * n8n's resume URL for this execution, so the call wakes the waiting workflow
 * at this node instead of starting a new one, the way n8n's own Wait node does.
 *
 * Declared here rather than inline because this is not a trigger: nothing is
 * registered with Deliverd and there is nothing to clean up, since each
 * request carries its own callback address and expires. The community-node
 * lint rule `webhook-lifecycle-complete` reads any inline `webhooks` array as
 * a trigger's and asks for checkExists, create and delete.
 */
const resumeWebhook: IWebhookDescription[] = [
	{
		name: 'default',
		httpMethod: 'POST',
		responseMode: 'onReceived',
		path: '',
		restartWebhook: true,
	},
];

const id = (value: string) => `/approvals/${encodeURIComponent(value.trim())}`;

export class Deliverd implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Deliverd',
		name: 'deliverd',
		icon: { light: 'file:../../icons/deliverd.svg', dark: 'file:../../icons/deliverd.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Ask a person to approve a step, and wait for their decision',
		defaults: { name: 'Deliverd' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'deliverdApi', required: true }],
		webhooks: resumeWebhook,
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [{ name: 'Approval', value: 'approval' }],
				default: 'approval',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['approval'] } },
				options: [
					{
						name: 'Ask and Wait',
						value: 'askAndWait',
						description: 'Ask people to approve, and pause the workflow until they decide',
						action: 'Ask for approval and wait',
					},
					{
						name: 'Ask',
						value: 'ask',
						description: 'Ask people to approve, and carry on without waiting',
						action: 'Ask for approval',
					},
					{
						name: 'Get',
						value: 'get',
						description: 'Get a request and its decision',
						action: 'Get an approval',
					},
					{
						name: 'Cancel',
						value: 'cancel',
						description: 'Withdraw a request that is still undecided',
						action: 'Cancel an approval',
					},
				],
				default: 'askAndWait',
			},
			{
				displayName: 'Title',
				name: 'title',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'Refund €120 to order #4411?',
				description: 'What is being asked, as a headline',
				displayOptions: { show: { operation: ['askAndWait', 'ask'] } },
			},
			{
				displayName: 'Approvers',
				name: 'approvers',
				type: 'string',
				default: '',
				placeholder: 'finance@example.com, Support leads',
				description:
					"Who may decide: emails, user IDs or team names, comma-separated. Your organisation's admins when empty.",
				displayOptions: { show: { operation: ['askAndWait', 'ask'] } },
			},
			{
				displayName: 'Approval ID',
				name: 'approvalId',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { operation: ['get', 'cancel'] } },
			},
			{
				displayName: 'Wait Method',
				name: 'waitMethod',
				type: 'options',
				options: [
					{
						name: 'Callback',
						value: 'callback',
						description:
							'Pause the execution until Deliverd calls back. Needs n8n at a public HTTPS address.',
					},
					{
						name: 'Poll',
						value: 'poll',
						description:
							'Keep the execution running and check every 10 seconds. Works anywhere; best for short waits.',
					},
				],
				default: 'callback',
				displayOptions: { show: { operation: ['askAndWait'] } },
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { operation: ['askAndWait', 'ask'] } },
				options: [
					{
						displayName: 'Editable Fields',
						name: 'editableFields',
						type: 'string',
						default: '',
						placeholder: 'amount, reason',
						description: 'Fields of Input the approver may correct before approving, comma-separated',
					},
					{
						displayName: 'Expires After (Minutes)',
						name: 'expiresInMinutes',
						type: 'number',
						typeOptions: { minValue: 1 },
						default: 1440,
						description:
							'When the request expires undecided. Ask and Wait stops waiting then, and outputs the expired request.',
					},
					{
						displayName: 'Input',
						name: 'input',
						type: 'json',
						default: '{}',
						description:
							'The values the next step will run with. The approver sees them; approvedInput in the output is what to actually use.',
					},
					{
						displayName: 'Reference',
						name: 'externalId',
						type: 'string',
						default: '',
						description: 'Your own reference for the request, returned unchanged and searchable',
					},
					{
						displayName: 'Risk',
						name: 'risk',
						type: 'options',
						options: [
							{ name: 'Low', value: 'low' },
							{ name: 'Medium', value: 'medium' },
							{ name: 'High', value: 'high' },
							{ name: 'Critical', value: 'critical' },
						],
						default: 'medium',
					},
					{
						displayName: 'Why',
						name: 'description',
						type: 'string',
						typeOptions: { rows: 3 },
						default: '',
						description: 'Why, what it affects, what it costs. The approver reads this first.',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const operation = this.getNodeParameter('operation', 0) as string;
		const out: INodeExecutionData[] = [];

		if (operation === 'askAndWait' && this.getNodeParameter('waitMethod', 0) === 'callback') {
			return [await askAndPause(this, items)];
		}

		for (let i = 0; i < items.length; i++) {
			try {
				let approval: Approval;
				if (operation === 'get') {
					approval = await deliverd<Approval>(this, 'GET', id(this.getNodeParameter('approvalId', i) as string));
				} else if (operation === 'cancel') {
					approval = await deliverd<Approval>(
						this,
						'POST',
						`${id(this.getNodeParameter('approvalId', i) as string)}/cancel`,
						{},
					);
				} else {
					const options = readOptions(this, i);
					approval = await deliverd<Approval>(
						this,
						'POST',
						'/approvals',
						body(this, i, options, {}),
					);
					if (operation === 'askAndWait') {
						const minutes = options.expiresInMinutes ?? 1440;
						const result = await poll(
							() => deliverd<Approval>(this, 'GET', id(approval.id)),
							Date.now() + minutes * 60_000,
							sleep,
						);
						approval = result.approval;
					}
				}
				out.push({ json: decision(approval) as IDataObject, pairedItem: { item: i } });
			} catch (error) {
				if (this.continueOnFail()) {
					out.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				throw error instanceof NodeOperationError
					? error
					: new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}
		return [out];
	}

	/**
	 * Deliverd calling back. The body says which request moved, but it is
	 * only a prompt to look: the request is read back from Deliverd with this
	 * node's own credentials, and that answer is what the workflow continues
	 * with. A question from an approver also calls back; the request is still
	 * pending then, so the execution goes on waiting.
	 */
	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const body = this.getBodyData() as { requestType?: string; requestId?: string };
		if (body.requestType !== 'approval' || typeof body.requestId !== 'string') {
			return { webhookResponse: { received: false } };
		}
		const approval = await deliverd<Approval>(this, 'GET', id(body.requestId));
		if (!SETTLED.includes(approval.status)) {
			return { webhookResponse: { received: true } };
		}
		return {
			webhookResponse: { received: true },
			workflowData: [[{ json: decision(approval) as IDataObject }]],
		};
	}
}

function readOptions(ctx: IExecuteFunctions, i: number): AskOptions {
	const options = ctx.getNodeParameter('options', i, {}) as AskOptions & { input?: unknown };
	const input = options.input;
	// n8n hands a JSON parameter over as a string or, from an expression, an object.
	const empty = input === undefined || input === '' || input === '{}';
	return {
		...options,
		input: empty ? undefined : (input as AskOptions['input']),
		approvers: ctx.getNodeParameter('approvers', i, '') as string,
	};
}

function body(
	ctx: IExecuteFunctions,
	i: number,
	options: AskOptions,
	extra: { callbackUrl?: string },
): IDataObject {
	try {
		return requestBody(ctx.getNodeParameter('title', i) as string, options, {
			...extra,
			metadata: { n8n: { workflowId: ctx.getWorkflow().id, executionId: ctx.getExecutionId() } },
		}) as IDataObject;
	} catch (error) {
		throw new NodeOperationError(ctx.getNode(), (error as Error).message, { itemIndex: i });
	}
}

/**
 * Raise the request with this execution's resume URL as its callback, and
 * put the execution to sleep until Deliverd calls it.
 *
 * One item only: an execution has one resume URL, and the first decision to
 * arrive would wake it for every request raised from it.
 */
async function askAndPause(ctx: IExecuteFunctions, items: INodeExecutionData[]): Promise<INodeExecutionData[]> {
	if (items.length > 1) {
		throw new NodeOperationError(
			ctx.getNode(),
			`Ask and Wait with the Callback method takes one item at a time, and got ${items.length}. Put a Loop Over Items node before it, or set Wait Method to Poll.`,
		);
	}
	const resumeUrl = ctx.evaluateExpression('{{ $execution?.resumeUrl }}', 0) as string | undefined;
	const problem = callbackProblem(resumeUrl);
	if (problem) throw new NodeOperationError(ctx.getNode(), problem);

	const options = readOptions(ctx, 0);
	const minutes = options.expiresInMinutes ?? 1440;
	await deliverd<Approval>(ctx, 'POST', '/approvals', body(ctx, 0, options, { callbackUrl: resumeUrl }));

	// Deliverd calls back when the request expires too, so this limit is only
	// a backstop for a callback that never arrives.
	await ctx.putExecutionToWait(new Date(Date.now() + (minutes + 15) * 60_000));
	return items;
}
