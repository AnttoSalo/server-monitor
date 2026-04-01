module.exports = {
	apps: [
		{
			name: 'monitor-mcp',
			script: 'server.js',
			env: {
				MCP_API_KEY: '0ed000bd330680f91c118c167e90a0d78151ab9c123639057fc2e86cceee017f',
				MCP_PORT: 3103,
				MONITOR_URL: 'http://localhost:3099/monitor'
			},
			max_memory_restart: '200M'
		}
	]
};
