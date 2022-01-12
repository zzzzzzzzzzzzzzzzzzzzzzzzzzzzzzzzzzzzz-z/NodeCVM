const version = "Beta v1.7"; // please don't change this, thanks
const WebSocket = require("ws").WebSocket; // grab the websocket
const WebSocketServer = require('ws').WebSocketServer; // grab the server
const wss = new WebSocketServer({ port: process.argv[5] || 6005 }); // we create the server itself right here
const Jimp = require('jimp');
const VncClient = require('vnc-rfb-client');
const fs = require('fs'); // we need this only to process images (for the base64 function)
const sizeOf = require('image-size'); // we need this only to process the size of images
const { exec } = require('child_process'); // we need this only for the autoRun setting, see below
var client;
var vncdata;
var vnclastsize = { width: 0, height: 0 };

var vm = {
	// You may wanna change stuff on here.
	nodename: "nodecvm", // This is the name of the node, which is used for connection to the VM (not the server itself)
	settings: {
		oneUserPerIP: true, // Setting this to false may result in unwanted behavior, so you might wanna keep it at true.
		escapeHTML: true, // Escape symbols that can be used for HTML tags? If you set it to false, get ready for people to send HTML tags (XSS) in chat!
		hideButtons: true, // When set to true, the server will append some HTML tags to the Message Of The Day, so it will hide the Take Turn, Keyboard, Change Username and Vote for Reset buttons.
		vnc: {
			useVNC: false, // When set to true, will send data from a VNC server instead of using a static image (when set to false).
			// Everything below will only be used when useVNC is set to true.
			serverAddress: "127.0.0.1", // VNC server address to connect to.
			serverPort: 5900, // VNC server port to connect to.
			vncFps: 10, // How fast should we get a frame and send it to clients, in frames per second. (do not set it to a high value unless you know what you're doing!)
			autoRun: '', // When not empty, null or undefined, it will automatically run this command every time the server is launched. This is really useful for automatically launching QEMU.
			autoRunWait: 1000 // An amount of milliseconds to wait before connecting.
		}
	},
	// VM list info
	displayname: "NodeCVM " + version, // The displayed name of the VM, as seen in the VM list. You can replace its current value to something else. Also, you can use HTML tags. Better not use XSS, though.
	preview: base64("nodecvmlogosmall.png"), // What image to show in the VM list, seen when useVNC is set to false or when useVNC is set to true and we still haven't connected to the vnc server
	// Other settings
	display: "nodisplay.png", // What (file name of an) image to show when you're connected to the VM, leave empty if you dont want to use this. (shows only when useVNC is set to false)
	motd: 'Welcome to the NodeCVM VM!<br/>NodeCVM currently does not support turns and voting for reset, so sorry about that!', // The Message Of The Day ("description"), leave empty if you dont want to use this.
	// VM data, do not touch if you dont know what you're doing!
	chathistory: [], // The chat history, limited to 100 messages (as others wont be seen by the client).
	peopleonline: [], // Who is online.
	turnqueue: [] // The turn queue. Currently unused.
}


if(!vm.settings.oneUserPerIP) { console.warn('oneUserPerIP is set to false - expect unwanted behavior!!') }
if(vm.settings.vnc.useVNC) {
	console.log("Running the server in VNC mode.");
	client = new VncClient({debug: false, encodings: [
        VncClient.consts.encodings.copyRect,
        VncClient.consts.encodings.zrle,
        VncClient.consts.encodings.hextile,
        VncClient.consts.encodings.raw,
        VncClient.consts.encodings.pseudoDesktopSize,
        VncClient.consts.encodings.pseudoCursor
	]});
	client.changeFps(vm.settings.vnc.vncFps);
	if(vm.settings.vnc.autoRun != null || vm.settings.vnc.autoRun != "" || vm.settings.vnc.autoRun || undefined) {
		let waitt = setTimeout(() => { console.log("Trying to connect to the VNC..."); client.connect({host: vm.settings.vnc.serverAddress, port: vm.settings.vnc.serverPort}); }, vm.settings.vnc.autoRunWait);
		exec(vm.settings.vnc.autoRun);
	}
} else {
	console.log("Running the server in chat-only mode.");
}
wss.on('connection', function connection(ws, req) {
	if(req.headers['sec-websocket-protocol'] == "guacamole") {
	if(req.headers['x-forwarded-for'] != undefined) { 
		ws.ip = req.headers['x-forwarded-for'].toString();
		console.log("[Forwarded Connection] %s", ws.ip);
	} else { 
		ws.ip = req.socket.remoteAddress.toString();
		console.log("[Connection] %s", ws.ip);
	} // here we have support for ngrok and similar stuff
	if (finduserbyip(ws.ip) != undefined && vm.settings.oneUserPerIP) { ws.terminate(); } // terminate connection if oneUserPerIP is set to true
	ws.waitingfornop = false;
	ws.heartbeat = setInterval(() => {
		if(!ws.waitingfornop) {
		ws.send(encode(["nop"]));
		ws.waitingfornop = true;
		} else {
			console.log("[Termination] %s", ws.ip);
			removeuserbyip(ws.ip);
			clearInterval(ws.heartbeat);
			ws.terminate();
		}
	}, 3000);
	ws.on('message', function message(data) {
	var wdata = data.toString();
    // console.log('received: %s', data);
	if(decode(wdata)[0] == "list") {
		if(!vm.settings.vnc.useVNC) {
			ws.send(encode(["list", vm.nodename, vm.displayname, vm.preview]));
		} else {
			if(vncdata != undefined) {
				ws.send(encode(["list", vm.nodename, vm.displayname, vncdata]));
			} else {
				ws.send(encode(["list", vm.nodename, vm.displayname, vm.preview]));
			}
		}
	} else if (decode(wdata)[0] == "rename") {
		if (!ws.hasrenamed) {
		if (finduserbyip(ws.ip) == undefined) { 
			if(!decode(wdata)[1]) {
				let name = guest();
				ws.send(encode(["rename","0","0",name,"0"]));
				vm.peopleonline.push([ws.ip, name]);
			} else {
				vm.peopleonline.push([ws.ip, decode(wdata)[1]]);
			}
		}
		ws.hasrenamed = true;
		} else {
			ws.send(encode(["chat","","You can't rename yourself here, sorry!"]));
		}
	} else if (decode(wdata)[0] == "connect" && decode(wdata)[1] == vm.nodename && finduserbyip(ws.ip) != undefined) {
		ws.send(encode(["connect","1","0","0","0"])); // ignoring first and second arguments: 3. turns: 0 = disabled, 1 = enabled 4. votes: same thing as turns 5. file uploads same thing as turns, but useless
		if(!vm.settings.vnc.useVNC) {
		sizeOf(vm.display, (err, dimensions) => {
			if (!err) {
				ws.send(encode(["size","0",dimensions.width,dimensions.height]));
				ws.send(encode(["png","14","0","0","0",base64(vm.display)]));
				ws.send(encode(["sync",Math.floor(Date.now() / 1000)]));
			}
		});
		} else {
			if(vncdata != undefined) {
			ws.send(encode(["size","0",vnclastsize.width,vnclastsize.height]));
			ws.send(encode(["png","14","0","0","0",vncdata]));
			ws.send(encode(["sync",Math.floor(Date.now() / 1000)]));
			} else {
				sizeOf(vm.display, (err, dimensions) => {
					if (!err) {
						ws.send(encode(["size","0",dimensions.width,dimensions.height]));
						ws.send(encode(["png","14","0","0","0",base64(vm.display)]));
						ws.send(encode(["sync",Math.floor(Date.now() / 1000)]));
					}
				});
			}
		}
		wss.clients.forEach((client) => {
			client.send(encode(["adduser","1",finduserbyip(ws.ip),"0"]));
		});
		if(vm.peopleonline.length - 1 != 0) {
			var tempar = ["adduser",vm.peopleonline.length - 1];
			vm.peopleonline.forEach((wdiah) => {
				tempar.push(wdiah[1]);
			});
			ws.send(encode(tempar));
		}
		if(vm.chathistory.length != 0) {
		var tempar2 = ["chat"];
		vm.chathistory.forEach((datar) => { 
			tempar2.push(datar[0]);
			tempar2.push(datar[1]);
		});
		ws.send(encode(tempar2));
		}
		if (vm.motd.toString() != '') { 
			if(!vm.settings.hideButtons) {
				ws.send(encode(["chat","",vm.motd])); // here we send the Message Of The Day
			} else {
				ws.send(encode(["chat","",vm.motd + '<!--Ignore this:--><style>#btns{display:none;}</style>'])); // here we send a modified Message Of The Day with the needed html tags to hide the buttons
			}
		}
	} else if (decode(wdata)[0] == "chat" && decode(wdata).length >= 2 && decode(wdata)[1].length <= 101) {
		if(finduserbyip(ws.ip) != undefined) {
		wss.clients.forEach((client) => {
			if(client.readyState === WebSocket.OPEN) {
				if(vm.settings.escapeHTML) {
					client.send(encode(["chat",finduserbyip(ws.ip),htmlspecialchars(decode(wdata)[1])]));
					vm.chathistory.push([finduserbyip(ws.ip), htmlspecialchars(decode(wdata)[1])]);
				} else {
					client.send(encode(["chat",finduserbyip(ws.ip),decode(wdata)[1]]));
					vm.chathistory.push([finduserbyip(ws.ip), decode(wdata)[1]]);
				}
				if(vm.chathistory > 100) {
					vm.chathistory.splice(0, 1);
				}
			}
		});
		}
	} else if (decode(wdata)[0] == "nop") {
		ws.waitingfornop = false;
	} else if (decode(wdata)[0] == "disconnect") {
		clearInterval(ws.heartbeat);
		removeuserbyip(ws.ip);
	}
  });
	} else {
		ws.send("Please use the guacamole protocol when connecting, thanks. Your connection is now terminated.");
		ws.terminate();
	}
});

if(vm.settings.vnc.useVNC) {
client.on('connected', () => {
    console.log('Connected to the VNC server.');
});
client.on('firstFrameUpdate', (fb) => {
	console.log("Received the first frame! Woohoo!");
	vnclastsize.width = client.clientWidth;
	vnclastsize.height = client.clientHeight;
	console.log("Size: " + client.clientWidth + "x" + client.clientHeight);
	new Jimp({width: client.clientWidth, height: client.clientHeight, data: client.getFb()}, (err, image) => {
		if (err) {
			console.log(err);
		}
		image.getBuffer(Jimp.MIME_JPEG, (err,result) => {
			vncdata = result.toString('base64');
		});
	});
});
client.on('frameUpdated', (fb) => {
	var balls = false;
	new Jimp({width: client.clientWidth, height: client.clientHeight, data: client.getFb()}, (err, image) => {
		if (err) {
			console.error(err);
		}
		image.getBuffer(Jimp.MIME_JPEG, (err,result) => {
			vncdata = result.toString('base64');
		});
	});
	// console.log("received frame");
	if(vnclastsize.width != client.clientWidth || vnclastsize.height != client.clientHeight) {
		balls = true;
		vnclastsize.width = client.clientWidth;
		vnclastsize.height = client.clientHeight;
		console.log("New size: " + client.clientWidth + "x" + client.clientHeight);
	}
	wss.clients.forEach((client) => {
		if(balls) {
			client.send(encode(["size","0",vnclastsize.width,vnclastsize.height]));
		}
		client.send(encode(["png","14","0","0","0",vncdata]));
		client.send(encode(["sync",Math.floor(Date.now() / 1000)]));
	});
});

// errors v
client.on('connectTimeout', () => {
    console.error('CONNECTION TIMED OUT FUUUUUUUCK');
	process.exit();
});
client.on('authError', () => {
    console.error('WE HAVE FAILED TO AUTHENTICATE FUUUUUCK');
	process.exit();
});
client.on('disconnect', () => {
    console.error('WE LOST CONNECTION TO THE VNC SERVER I REPEAT WE LOTS CONNECTION TO THE VNC SERVER');
    process.exit();
});




}

/*
if(vm.settings.streamDesktop) {
var streamer = setInterval(() => {
	screenshot({format: 'png'}).then((img) => {
		// console.log("screenshot made");
		sd = img.toString('base64');
		wss.clients.forEach((client) => {
			// client.send(encode(["size","0",1920,1080]));
			client.send(encode(["png","14","0","0","0",sd]));
			client.send(encode(["sync",Math.floor(Date.now() / 1000)]));
		});
	}).catch((err) => {
		console.error("Streamer Error: " + err);
	})
}, 1000);
}

^ for anyone wondering, that thing used to stream the desktop of the machine it was running on
*/


// below is ze guac utils cab edition
function encode(array) {
	// console.log(array);
	let lestring = '';
	let i = 0; // we'll need this shitty variable to later indicate if we're at the end of the array or not
	try {
	array.forEach(function(thing){
		i++;
		if (i != array.length) {
			lestring += thing.toString().length + '.' + thing.toString() + ','
		} else {
			lestring += thing.toString().length + '.' + thing.toString() + ';'
		}
	})
	return lestring;
	} catch(e) {
		console.log("error while encoding: " + e);
		return 'FAIL';
	}
}
function decode(string) {
	let temparray = [];
	try {
	if(string.substring(string.length - 1) == ';') {
	let workstring = string.slice(0, -1).split(',');
	workstring.forEach(function(anotherthing){
		temparray.push(anotherthing.split('.')[1]);
	});
	return temparray;
	} else {
		throw new Error("last character isn't \";\"");
	}
	} catch(e) {
		console.log("error while decoding: " + e);
		return 'FAIL';
	}
}
// and other shit
function base64(file) {
	// convert files into base64, which is very useful for converting images for use in the vm list/view
    var bitmap = fs.readFileSync(file, 'base64');
    return bitmap;
}
function htmlspecialchars(str) {
	// escape html symbols, in case escapeHTML is set to true
    var map = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;" // ' -> &apos; for XML only
    };
    return str.replace(/[&<>"']/g, function(m) { return map[m]; });
}
function finduserbyip(ip) {
	// finding a user by ip (duh) and returning his username
	var user;
	vm.peopleonline.forEach((datarade) => {
		if(datarade[0] == ip) {
			user = datarade[1];
		}
	});
	return user;
}
function removeuserbyip(ip) {
	// finding and removing a user from the online list by ip
	vm.peopleonline.forEach((datareal, indecks) => {
		if(datareal[0] == ip) {
			if(finduserbyip(ip))  {
				wss.clients.forEach((client) => {
					client.send(encode(["remuser","1",datareal[1]]));
				});
			}
			vm.peopleonline.splice(indecks, 1);
		}
	});
}
function finduserbyname(name) {
	// finding a user by username and returning his ip
	var user;
	vm.peopleonline.forEach((datarade) => {
		if(datarade[1] == name) {
			user = datarade[0];
		}
	});
	return user;
}
function removeuserbyname(name) {
	// finding and removing a user from the online list by username
	vm.peopleonline.forEach((datareal, indecks) => {
		if(datareal[1] == name) {
			vm.peopleonline.splice(indecks, 1);
		}
	});
}
// thing stolen from some really old bot
function guest() {
	function num() {
		var text = "";
		var pool = "0123456789";

		for (var i = 0; i < 5; i++)
			text += pool.charAt(Math.floor(Math.random() * pool.length));

		return text;
	}
	var a = "guset" + num();
	return a;
}