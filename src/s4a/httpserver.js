// HTTP protocol, based on S4A's

IDE_Morph.prototype.originalInit = IDE_Morph.prototype.init;
IDE_Morph.prototype.init = function (globals) {
    this.originalInit(globals);

    var myself = this;

    if (this.httpServer) { this.httpServer.close() };
    this.httpServer = require('http').createServer(function(request, response) { myself.handleHTTPRequest(request, response) });
    this.httpServer.setTimeout(500);

    this.isServerOn = false;
};

IDE_Morph.prototype.toggleServer = function () {
    if (this.isServerOn) {
        this.stopServer();
    } else {
        this.startServer();
    }
};

IDE_Morph.prototype.startServer = function () {
    var myself = this,
        ifaces = require('os').networkInterfaces(),
        iips = '',
        eips = '';

    Object.keys(ifaces).forEach(function (ifname) {
        ifaces[ifname].forEach(function (iface) {
            if (iface.family =='IPv4') {
                if (iface.internal) {
                    iips += 'http://' + iface.address + ':42001\n';
                } else {
                    eips += 'http://' + iface.address + ':42001\n';
                }
            }
        });
    });

    this.httpServer.listen(
            42001, 
            function() {
                myself.isServerOn = true;
                myself.inform(
                        'HTTP server', 
                        'This Snap4Arduino instance can be remotely\n'
                        + 'controlled from the following addresses:\n\n'
                        + 'Internal URLs:\n'
                        + iips
                        + '\nExternal URLs:\n' 
                        + eips)
            });
};

IDE_Morph.prototype.stopServer = function () {
    var myself = this;
    myself.isServerOn = false;
    this.httpServer.close(
            function () {
                myself.inform('HTTP server', 'HTTP server connection closed');
            });
};

IDE_Morph.prototype.handleHTTPRequest = function (request, response) {
    if (!this.isServerOn) { return; };

    var myself = this;

    response.setHeader('Access-Control-Allow-Origin', '*');
    response.writeHead(200, {'Content-Type': 'text/plain; charset=utf-8'});
    function parse(message) {

        if (message.length > 0) {

            // If the command came inside a POST body, it needs to be split by spaces,
            // otherwise it came in a GET URL and it needs to be split by "="

            var command = message.indexOf('=') > 0 ? message.split('=') : message.split(' ');

            switch (command[0]) {
                case 'broadcast':
                    var bcMessage = typeof command[1] !== 'undefined' ? message.slice(10) : '',
                        stage = myself.stage,
                        rcvrs = stage.children.concat(stage);

                    if (bcMessage.length > 0) {

                        stage.lastMessage = bcMessage;

                        rcvrs.forEach(function (morph) {
                            if (morph instanceof SpriteMorph || morph instanceof StageMorph) {
                                morph.allHatBlocksFor(bcMessage).forEach(function (block) {
                                    stage.threads.startProcess(
                                        block,
                                        morph,
                                        stage.isThreadSafe
                                )});
                            }
                        });

                        response.write('broadcast ' + bcMessage);

                    } else {
                        response.write('No message provided');
                    }
                    break;

                case 'vars-update':
                    if (typeof command[1] == 'undefined' || command[1] == '') {
                        response.write('No variable provided');
                    } else {
                        var varName = command[1],
                            value = message.slice(command[0].length+command[1].length+2),
                            stage = myself.stage;

                        if (Object.keys(stage.globalVariables().vars).indexOf(varName) == -1) {
                            response.write('Variable ' + varName + ' does not exist');
                        } else {
                            stage.globalVariables().setVar(varName, value, stage);
                            response.write('Updating variable ' + command[1] + ' to value ' + value);
                        }
                    }
                    break;

                case 'send-messages':
                    var contents = 'broadcast',
                        stage = myself.stage;

                    stage.children.concat(stage).forEach(function (morph) {
                        if (morph instanceof SpriteMorph || morph instanceof StageMorph) {
                            morph.allMessageNames().forEach(function (message) {
                                contents += ' "' + message + '"';
                            });
                        }
                    });

                    response.write(contents);
                    break;

                case 'send-vars':
                    var contents = 'sensor-update',
                        stage = myself.stage;

                    Object.keys(stage.globalVariables().vars).forEach(function (varName) {
                        contents += ' "' + varName + '" ' + stage.globalVariables().vars[varName].value.toString();
                    });

                    response.write(contents);
                    break;

                case 'send-var':
                    var stage = myself.stage,
                        varName = command[1];
                    if (Object.keys(stage.globalVariables().vars).indexOf(varName) == -1) {
                        response.write('Variable ' + varName + ' does not exist');
                    } else {
                        response.write(stage.globalVariables().vars[varName].value.toString());
                    }
                    break;

                case 'stage':
                    var contents = '<html><img id="stage" src="' + myself.stage.fullImageClassic().toDataURL() + '" /><script>' +
                        'var ajax = new XMLHttpRequest();' +
                        'function getData() {' + 
                            'var time = new Date();' +
                            'ajax.open("GET", "stageimg", false); ajax.send();' +
                            'document.getElementById("stage").src = ajax.responseText;' +
                            'setTimeout(getData, Math.min(new Date() - time, 100));' + 
                        '}; getData();' +
                        '</script></html>';
                    response.write(contents);
                    break;

                case 'stageimg':
                    response.setHeader('Cache-Control', 'no-cache');
                    response.write(myself.stage.fullImageClassic().toDataURL());
                    break;

                case 'push':
                    response.write('Pushing project to file system');
                    var str = myself.serializer.serialize(myself.stage);
                    require('fs').writeFile(homePath() + 'autorun.xml', str);
                    break;

                default:
                    response.write('Unknown command');

            }
        } else {
            response.write('No command provided');
        }
    }

    if (request.method === 'POST') {

        var body = '',
            bodys = [];

        request.addListener('data', function(chunk) {
            body += chunk;
        });

        request.addListener('end', function(chunk){
            if (chunk) { 
                body += chunk;
            }
            bodys = body.split("&");
            response.write('POST processing...\n');
            bodys.forEach(function (item) {
                response.write('\n');
                parse('vars-update=' + decodeURIComponent(item));
            });
            response.end('\n\nPOST completed');
        });

    } else if (request.method === 'GET') {
        parse(request.url.slice(1));
        response.end();

    } else {
        response.end('Unknown request');
    }
};
