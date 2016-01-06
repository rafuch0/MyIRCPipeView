#!/usr/bin/env node

var DEBUG = { packets: false, normal: true };
var CONFIG = { standalone: true, https: true, basedir: 'www-root'};

var http = require('http');
var https = require('https');
var io = require('socket.io');
var irc = require('irc');
var util = require('util');
var fs = require('fs');
var repl = require('repl');
var path = require('path');

var server;
if(CONFIG.standalone)
{
	if(CONFIG.https)
	{
		var serverCerts = {
		        key: fs.readFileSync('ServerConfig/server.key'),
		        cert: fs.readFileSync('ServerConfig/server.cert')
		};

		server = https.createServer(serverCerts, ServerMain);
		server.listen('8081');
	}
	else
	{
		server = http.createServer(ServerMain);
		server.listen('80');
	}
}
else
{
	server = http.createServer(function(){});
	server.listen('1337');
}
var socket = io.listen(server);

var clientCount = 0;
var messageQueue = [];

var myClients = [
	{ alias: 'free', host: 'irc.freenode.net', port: '6697', ssl: true, username: 'muchmoist', password: '',
		channels: [ '##pixeldungeon' ], 
		client: null
	}
	,{ alias: 'snoo', host: 'irc.snoonet.org', port: '6697', ssl: true, username: 'muchmoist', password: '',
		channels: [ '#pixeldungeon' ], 
		client: null
	}
/*	,{ alias: 'anon', host: 'irc.anonops.net', port: '6697', ssl: true, username: 'test', password: '',
		channels: [ '#anonops' ], 
		client: null
	}
	,{ alias: 'efnet', host: 'irc.efnet.pl', port: '6667', ssl: false, username: 'test', password: '',
		channels: [ '#nethack' ], 
		client: null
	}
*/
];

var bindings = [
/*	{ fromS: 'free', fromC: '#nethack', toS: 'free', toC: '#testing005' },
	{ fromS: 'free', fromC: '#debian', toS: 'free', toC: '#testing005' },
	{ fromS: 'free', fromC: '#slackware', toS: 'free', toC: '#testing005' },
	{ fromS: 'free', fromC: '#bitcoin', toS: 'free', toC: '#testing005' },*/
	{ fromS: 'free', fromC: '##pixeldungeon', toS: 'snoo', toC: '#pixeldungeon' },
	{ fromS: 'snoo', fromC: '#pixeldungeon', toS: 'free', toC: '##pixeldungeon' },
];


var myRepl = repl.start({ input: process.stdin, output: process.stdout, prompt: 'ircpipe~# ', useGlobal: true, ignoreUndefined: true, terminal: true, useColors: true });
myRepl['context'].DEBUG = DEBUG;
myRepl['context'].myClients = myClients;
myRepl['context'].getClientIndex = getClientIndex;
myRepl['context'].say = say;

for(var i = 0, maxi = myClients.length; i < maxi; i++)
{
	myClients[i].client = getIRCClient(myClients[i]);
	myClients[i]['client'].connect(10);
}

setupSocketIOOptions();
setupSocketIOEventHandlers();
setupIRCClientEventHandlers();

setInterval(broadcastMessages, 750);

function setupSocketIOEventHandlers()
{
	socket.on('connection', NewClient);
}

function setupSocketIOOptions()
{
	socket.enable('browser client minification');
	socket.enable('browser client etag');
	socket.enable('browser client gzip');
	socket.set('log level', 0);
	if(DEBUG.packets) socket.set('log level', 3);
	socket.set('transports',
	[
		'websocket',
		'flashsocket',
		'htmlfile',
		'xhr-polling',
		'jsonp-polling'
	]);
}

process.on('SIGINT', function()
{
	cleanUp();

	setTimeout(process.exit, 3000);
});

function cleanUp()
{
	for(var i = 0, maxi = myClients.length; i < maxi; i++)
	{
		Object.keys(myClients[i]['client'].chans).forEach(function(chan)
		{
			if(DEBUG.normal) console.log('Leaving %s', chan);
			myClients[i]['client'].part(chan);
		});
	}
}

function getContentType(uri)
{
	var extension = uri.substr(-3);

	switch(extension)
	{
		case 'htm':
		case 'tml':
			return 'text/html';
		break;

		case 'css':
			return 'text/css';
		break;

		case '.js':
			return 'text/javascript';
		break;
	}
}

function ServerMain(request, response)
{
	var request_uri = './'+CONFIG.basedir+'/'+path.normalize('./'+((request.url == '' || request.url == '/')?'index.html':request.url));

	fs.exists(request_uri, function(exists)
	{
		if(exists)
		{
			fs.readFile(request_uri, function(error, content)
			{
				if(error)
				{
					response.writeHead(500);
					response.end();
				}
				else
				{
					response.writeHead(200, { 'Content-Type': getContentType(request_uri) });
					response.end(content, 'utf-8');
				}
			});
		}
		else
		{
			response.writeHead(404);
			response.end();
		}
	});	
}

function identifyWithServices(client)
{
	if(DEBUG.normal) console.log('Identifying with Services...');

	if(client['options'].password)
	{
		client.say('NickServ', 'identify '+client['options'].password);
	}
}

function joinChannels(client)
{
	if(DEBUG.normal) console.log('Auto-Joining Channels...');
	for(var i = 0, maxi = client['options']['channels'].length; i < maxi; i++)
	{
		joinChannel(client, client['options']['channels'][i], (i+1)*1000);
	}
}

function joinChannel(client, channel, delay)
{
	setTimeout(function()
	{
		if(DEBUG.normal) console.log('Auto-Joining channel: %s', channel);
		client.join(channel);
	}, delay );
}

function setupIRCClientEventHandlers()
{
	for(var i = 0, maxi = myClients.length; i < maxi; i++)
	{
		myClients[i]['client'].on('names',
			function(channel, nicks)
			{
				queueMessage({ type: 'names', server: this['options'].alias, channel: channel, nicks: nicks });
			}
		);

		myClients[i]['client'].on('registered',
			function(message)
			{
				if(DEBUG.normal) console.log('Connected to Server: %s', myServer);
				queueMessage({ type: 'registered', server: this['options'].alias });
			}
		);

		myClients[i]['client'].on('topic',
			function(channel, topic)
			{
				queueMessage({ type: 'topic', server: this['options'].alias, channel: channel, topic: topic });
			}
		);

		myClients[i]['client'].on('motd',
			function(motd)
			{
				if(DEBUG.normal) console.log('Recieved MOTD of size: %s', motd.length);

				identifyWithServices(this);
				setTimeout(joinChannels, 10000, this);

				queueMessage({ type: 'motd', server: this['options'].alias, motd: motd });
			}
		);

		myClients[i]['client'].on('message',
			function(from, to, message)
			{
				queueMessage({ type: 'message', server: this['options'].alias, from: from, to: to, message: message });
			}
		);

		myClients[i]['client'].on('join',
			function(channel, nick, message)
			{
				queueMessage({ type: 'join', server: this['options'].alias, channel: channel, nick: nick, message: message });
			}
		);

		myClients[i]['client'].on('part',
			function(channel, nick, reason, message)
			{
				queueMessage({ type: 'part', server: this['options'].alias, channel: channel, nick: nick, reason: reason, message: message });
			}
		);

		myClients[i]['client'].on('quit',
			function(nick, reason, channels, message)
			{
				queueMessage({ type: 'quit', server: this['options'].alias, channels: channels, nick: nick, reason: reason, message: message });
			}
		);

		myClients[i]['client'].on('notice',
			function(from, to, message)
			{
				queueMessage({ type: 'notice', server: this['options'].alias, nick: from, to: to, message: message });
			}
		);

		myClients[i]['client'].on('whois',
			function(info)
			{
				if(info)
				{
					queueMessage({ type: 'whois', server: this['options'].alias, info: info });
				}
			}
		);
	}
}

function getIRCClient(options)
{
	var ircOptions = {
		userName: options.username,
		realName: options.username,
		port: options.port,
		debug: DEBUG.packets,
		showErrors: DEBUG.normal,
		autoRejoin: true,
		autoConnect: false,
		channels: [],
		secure: options.ssl,
		selfSigned: true,
		certExpried: false,
		floodProtection: true,
		floodProtectionDelay: 1000,
		stripColors: true
	}

	var client = new irc.Client(options.host, options.username, ircOptions);
	client.options = options;
	return client;
}

function say(server, channel, message)
{
	var clientIndex = getClientIndex(server);

	if(clientIndex !== -1)
	{
		myClients[clientIndex]['client'].say(channel, message);
	}
}

function getClientIndex(alias)
{
	for(var i = 0, maxi = myClients.length; i < maxi; i++)
	{
		if(myClients[i].alias === alias)
		{
			return i;
		}
	}

	return -1;
}

function NewClient(client)
{
	client.on('disconnect', function()
	{
		clientCount = clientCount - 1;
	});

	client.on('whois', function(data)
	{
		if(data.nick && (data['nick'].length > 0) && (data['nick'].length < 20) && data.server && (data['server'].length > 0) && (data['server'].length < 20))
		{
			if(getClientIndex(data.server) !== -1)
			{
				if(DEBUG.normal) console.log('Whois Requested for user %s on server %s', data.nick, data.server);
				myClients[getClientIndex(data.server)]['client'].whois(data.nick);
			}
		}
	});

	client.on('join', function(data)
	{
		if(data.channel && (data['channel'].length > 0) && (data['channel'].length < 20) && data.server && (data['server'].length > 0) && (data['server'].length < 20))
		{
			if(getClientIndex(data.server) !== -1)
			{
				if(DEBUG.normal) console.log('Joining %s on server %s', data.channel, data.server);
				myClients[getClientIndex(data.server)]['client'].join(data.channel);
			}
		}		
	});

	client.on('part', function(data)
	{
		if(data.channel && (data['channel'].length > 0) && (data['channel'].length < 20) && data.server && (data['server'].length > 0) && (data['server'].length < 20))
		{
			if(getClientIndex(data.server) !== -1)
			{
				if(DEBUG.normal) console.log('Leaving %s on server %s', data.channel, data.server);
				myClients[getClientIndex(data.server)]['client'].part(data.channel);
				queueMessage({ type: 'parted', channel: data.channel, server: data.server });
			}
		}		
	});

	client.join('general');
	
	clientCount = clientCount + 1;
}

function clone(data)
{
	return JSON.parse(JSON.stringify(data));
}

function getPadding(str, padCount, padChar)
{
	var pads = padCount - (str.toString().length + 1);

	if(pads > 0)
	{
		return Array(pads).join(padChar);
	}
	else
	{
		return '';
	}
}

//var maxNickLength = 5;
function queueMessage(data)
{
	if(DEBUG.packets) console.log('%s', util.inspect(data));

	messageQueue.push(data);

	if(data.type === 'message')
	{
		for(var i = 0, maxi = bindings.length; i < maxi; i++)
		{
			if((data.server === bindings[i].fromS) && (data.to === bindings[i].fromC))
			{
				//if(data['from'].length + 1 > maxNickLength)
				//{
				//	maxNickLength = data['from'].length + 1;
				//}

				//var from = data.from+':'+getPadding(data.from, maxNickLength+2, ' ');
				var from = '<@'+data.from+'>'+' ';
				//myClients[getClientIndex(bindings[i].toS)]['client'].say(bindings[i].toC, from+data.message+' ('+bindings[i].fromS+bindings[i].fromC+')');
				myClients[getClientIndex(bindings[i].toS)]['client'].say(bindings[i].toC, from+data.message);
			}
		}
	}
}

function broadcastMessages()
{
	if(messageQueue.length > 0)
	{
		socket.sockets.in('general').volatile.emit('messageQueue', messageQueue);
	}

	messageQueue = [];
}
