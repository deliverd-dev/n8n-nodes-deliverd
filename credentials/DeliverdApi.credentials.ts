import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class DeliverdApi implements ICredentialType {
	name = 'deliverdApi';

	displayName = 'Deliverd API';

	icon: Icon = { light: 'file:../icons/deliverd.svg', dark: 'file:../icons/deliverd.dark.svg' };

	documentationUrl = 'https://github.com/deliverd-dev/n8n-nodes-deliverd#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'API Token',
			name: 'token',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Create one in Deliverd under Settings → API tokens, with approvals:write and approvals:read',
		},
		{
			displayName: 'URL',
			name: 'url',
			type: 'string',
			default: 'https://deliverd.dev',
			description: 'Only change this if your organisation uses its own Deliverd address',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.token}}',
			},
		},
	};

	// One approval, the cheapest call the scopes this node needs allow.
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.url.replace(/\\/+$/, "")}}/api/v1',
			url: '/approvals',
			method: 'GET',
			qs: { limit: 1 },
		},
	};
}
