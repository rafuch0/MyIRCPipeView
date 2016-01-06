var MAX_MESSAGES = { max: 150, bufferZone: 75 };
var DEBUG = { showRenderTime: false };

var socket = io.connect('/');

socket.on('messageQueue', recieveMessage);
setInterval(updatePage, 750);

var ircData = [];
var channelStats = {};
var showEvents = {};
var viewChannels = {};

function incrementStats(channel, server)
{
	if(channelStats[server+channel]) channelStats[server+channel].count = channelStats[server+channel].count + 1;
	else channelStats[server+channel] = { server: server, channel: channel, count: 1 };
}

function clearStats(channel, server)
{
	if(channelStats[server+channel]) delete channelStats[server+channel];
}

function clearChat()
{
	var element = document.getElementById('chatArea');

	clipChatText(element, 0, 0);
}

function clipChatText(element, maxMessages, bufferZone)
{
	var count = (element['innerHTML'].match(/<br>/g)||[]).length;
	var total = maxMessages + bufferZone;

	if(total === 0)
	{
		element.innerHTML = '';
	}
	else if(count > (maxMessages + bufferZone))
	{
		var chatTextRendered = element.innerHTML;

		chatTextRendered = chatTextRendered.split('<br>').splice(count - maxMessages, maxMessages).join('<br>')+'<br>';

		element.innerHTML = chatTextRendered;
	}
}

function appendContent(from, to)
{
	var element;
	while(element = from.firstChild)
	{
		from.removeChild(element);
		to.appendChild(element);
	}
}

function scrollPage()
{
	window.scrollTo(0, document.body.scrollHeight);
}

function toggleShowEvents(event)
{
	showEvents[event.id] = event.checked;
}

function toggleViewChannels(event)
{
	viewChannels[event.id] = event.checked;
}

function joinPrompt()
{
	var serverInput = window.prompt('A Channel on Which Server (alias)?', '');
	var channelInput = window.prompt('Join Which Channel?', '#');

	if(channelInput && (channelInput.length > 0) && (channelInput[0] === '#') && (channelInput.length > 1) && serverInput && (serverInput.length > 0) && (serverInput.length < 20))
	{
		requestJoin(channelInput, serverInput);
	}
}

function requestJoin(channel, server)
{
	socket.emit('join', { channel: channel, server: server } );
}

function requestPart(channel, server)
{
	socket.emit('part', { channel: channel, server: server } );
}

function requestWhois(nick, server)
{
	socket.emit('whois', { nick: nick, server: server } );
}

function clearParted(channel, server)
{
	clearStats(channel, server);

	updatePage();
}

function colorCode(str)
{
	var r = 128;
	var g = 64;
	var b = 32;

	var front;
	var back;

	if(str)
	{
		for(var i = 0, maxi = str.length; i < maxi; i++)
		{
			front = str.charCodeAt(i);
			back = str.charCodeAt(str.length - 1 - i);
			r = r + (Math.pow(front % 16, 2) + back) * (i * 4) - Math.pow((back + i) % 16, 2);
			g = g + (Math.pow(front % 16, 2) + back) * (i * 3) - Math.pow((back + i) % 16, 2);
			b = b + (Math.pow(front % 16, 2) + back) * (i * 2) - Math.pow((back + i) % 16, 2);
		}
	}

	r = (r >= 0) ? r : -1*r;
	g = (g >= 0) ? g : -1*g;
	b = (b >= 0) ? b : -1*b;

	r = (r + g + 32) % 256;
	g = (g + b + 64) % 256;
	b = (b + r + 128) % 256;

	r = r.toString(16);
	g = g.toString(16);
	b = b.toString(16);

	if(r.length === 1) r = '0'+r;
	if(g.length === 1) g = '0'+g;
	if(b.length === 1) b = '0'+b;

	return ''+r+g+b;
}

function colorCodeInverse(color)
{
        var colorInverse;
        var r;
        var g;
        var b;

        colorInverse = parseInt(color, 16);
        r = 255 - ((colorInverse & 0xff0000) >> 16);
        g = 255 - ((colorInverse & 0x00ff00) >> 8);
        b = 255 - (colorInverse & 0x0000ff);

        r = r.toString(16);
        g = g.toString(16);
        b = b.toString(16);

        if(r.length === 1) r = '0'+r;
        if(g.length === 1) g = '0'+g;
        if(b.length === 1) b = '0'+b;

        return ''+r+g+b;
}

var colorCodeMemoized = _.memoize(colorCode);
var colorCodeInverseMemoized = _.memoize(colorCodeInverse);

function ICHColorWrapper(id)
{
	return colorCodeMemoized(id);
}

function ICHInverseColorWrapper(id)
{
	return colorCodeInverseMemoized(colorCodeMemoized(id));
}

function renderLinks(messageData)
{
	var rendered = messageData.replace(/([^\s\(\[\"\>\<\;]|^)[^\s]{3,5}:\/\/([^\s\)\]\<\>]+|$)/g, function(match)
	{
		return ich.link({ url: match, color: ICHColorWrapper(match), colorInv: ICHInverseColorWrapper(match) });
	});

	return rendered;
}

function trueOrUndefined(thing)
{
	return (thing || (thing === undefined))
}

function updatePage()
{
	if(ircData && (ircData.length > 0))
	{
		if(DEBUG.showRenderTime)
		{
			var t1 = new Date();
		}

		var IRCData = ircData;
		ircData = [];

		var chatText = [];
		var ichData = null;

		for (var i = 0, maxi = IRCData.length; i < maxi; i++)
		{
			ichData = null;

			switch(IRCData[i].type)
			{
				case 'names':
					ichData = ich.names({ server: IRCData[i].server, channel: IRCData[i].channel, nicks: IRCData[i].nicks });
				break;

				case 'topic':
					var topicData = ich.topic({ server: IRCData[i].server, serverColor: ICHColorWrapper(IRCData[i].server), channel: IRCData[i].channel, channelColor: ICHColorWrapper, topic: IRCData[i].topic });
					ichData = renderLinks(topicData);
				break;

				case 'registered':
					ichData = ich.registered();
				break;

				case 'motd':
					var motdData = ich.motd({ server: IRCData[i].server, motd: IRCData[i].motd });
					ichData = renderLinks(motdData);
				break;

				case 'message':
					var messageData = '';

					if(trueOrUndefined(viewChannels[IRCData[i].server+IRCData[i].to]))
					{
						messageData = ich.message({ server: IRCData[i].server, serverColor: ICHColorWrapper(IRCData[i].server), serverbgColor: ICHInverseColorWrapper(IRCData[i].server), channel: IRCData[i].to, channelColor: ICHColorWrapper(IRCData[i].to), channelbgColor: ICHInverseColorWrapper(IRCData[i].to), nick: IRCData[i].from, nickColor: ICHColorWrapper(IRCData[i].from), nickbgColor: ICHInverseColorWrapper(IRCData[i].from), message: IRCData[i].message });
					}

					ichData = renderLinks(messageData);
				break;

				case 'join':
					if(showEvents.showJoins)
					{
						if(trueOrUndefined(viewChannels[IRCData[i].server+IRCData[i].channel]))
						{
							ichData = ich.join({ server: IRCData[i].server, serverColor: ICHColorWrapper(IRCData[i].server), channel: IRCData[i].channel, channelColor: ICHColorWrapper, nick: IRCData[i].nick, nickColor: ICHColorWrapper(IRCData[i].nick), message: IRCData[i].message });
						}
					}
				break;

				case 'part':
					if(showEvents.showParts)
					{
						if(trueOrUndefined(viewChannels[IRCData[i].server+IRCData[i].channel]))
						{
							ichData = ich.part({ server: IRCData[i].server, serverColor: ICHColorWrapper(IRCData[i].server), channel: IRCData[i].channel, channelColor: ICHColorWrapper, nick: IRCData[i].nick, nickColor: ICHColorWrapper(IRCData[i].nick), message: IRCData[i].message });
						}
					}
				break;

				case 'quit':
					if(showEvents.showQuits)
					{
						ichData = ich.quit({ server: IRCData[i].server, serverColor: ICHColorWrapper(IRCData[i].server), channels: IRCData[i].channels, nick: IRCData[i].nick, nickColor: ICHColorWrapper(IRCData[i].nick), message: IRCData[i].message });
					}
				break;

				case 'notice':
					var messageData = ich.message({ server: IRCData[i].server, serverColor: ICHColorWrapper(IRCData[i].server), channel: IRCData[i].to, channelColor: ICHColorWrapper, nick: IRCData[i].from, nickColor: ICHColorWrapper(IRCData[i].from), message: IRCData[i].message });
					ichData = renderLinks(messageData);
				break;

				case 'whois':
					ichData = ich.whois({ server: IRCData[i].server, serverinfo: IRCData[i].serverinfo, nick: IRCData[i].nick, nickColor: ICHColorWrapper(IRCData[i].nick), user: IRCData[i].user, host: IRCData[i].host, realname: IRCData[i].realname, channels: IRCData[i].channels });
				break;

				default:
					ichData = ich.error({ message: 'Method Not Implemented' });
				break;
			}

			if(ichData) chatText.push(ichData);
		}

		if(chatText.length > 0)
		{
			var oldData = document.getElementById('chatArea');

			var newData = document.createElement('div');
			newData.innerHTML = chatText.join('');
			appendContent(newData, oldData);

			clipChatText(oldData, MAX_MESSAGES.max, MAX_MESSAGES.bufferZone);
			scrollPage();
		}

		var statsArray = [];
		Object.keys(channelStats).forEach(function(stats)
		{
			statsArray.push({ channel: channelStats[stats].channel, server: channelStats[stats].server, count: channelStats[stats].count, checked: ((viewChannels[channelStats[stats].server+channelStats[stats].channel] === undefined) || (viewChannels[channelStats[stats].server+channelStats[stats].channel] === true))?'checked':'' });
		});

		var statsAreaData = ich.stats({ stats: statsArray });
		document.getElementById('statsArea').innerHTML = statsAreaData;

		if(DEBUG.showRenderTime)
		{
			var t2 = new Date();
			var tdiff = t2 - t1;
			console.log('Render Time: %s ms (%s Messages)', tdiff, IRCData.length);
		}
	}
}

function recieveMessage(data)
{
	var message;
	for(entry in data)
	{
		message = data[entry];

		switch(message.type)
		{
			case 'names':

				var nicksArray = [];

				Object.keys(message.nicks).forEach(function(nick)
				{
					nicksArray.push({ nick: nick, mode: message['nicks'][nick] });
				});

				ircData.push({ type: 'names', server: message.server, channel: message.channel, nicks: nicksArray });
			break;

			case 'topic':
				ircData.push({ type: 'topic', server: message.server, channel: message.channel, topic: message.topic });
			break;

			case 'registered':
				ircData.push({ type: 'registered', server: message.server });
			break;

			case 'motd':
				var motd = '';

				motd = message['motd'].replace(/\n/g, '<br>');

				ircData.push({ type: 'motd', server: message.server, motd: motd });
			break;

			case 'message':
				incrementStats(message.to, message.server);
				ircData.push({ type: 'message', server: message.server, to: message.to, from: message.from, message: message.message });
			break;

			case 'join':
				incrementStats(message.channel, message.server);
				ircData.push({ type: 'join', server: message.server, channel: message.channel, nick: message.nick, message: 'has joined.' });
			break;

			case 'part':
				incrementStats(message.channel, message.server);
				var partMessage = 'has parted' + (message.reason?' with reason '+message.reason:'.');
				ircData.push({ type: 'part', server: message.server, channel: message.channel, nick: message.nick, message: partMessage });
			break;

			case 'quit':
				var quitMessage = 'has quit' + (message.reason?' with reason '+message.reason:'.');
				ircData.push({ type: 'quit', server: message.server, nick: message.nick, channels: message.channels, message: quitMessage });
			break;

			case 'notice':
				ircData.push({ type: 'notice', server: message.server, from: message.from, to: message.to, message: message.message });
			break;

			case 'whois':
				ircData.push({ type: 'whois', server: message['info'].server, serverinfo: message['info'].serverinfo, nick: message['info'].nick, user: message['info'].user, host: message['info'].host, realname: message['info'].realname, channels: message['info'].channels });
			break;

			case 'parted':
				clearParted(message.channel, message.server);
				setTimeout(function()
				{
					clearParted(message.channel, message.server);
					updatePage();
				}, 7500);
			break;

			default:
				ircData.push({ type: 'NotImplemented' });
			break;
		}
	}
}
