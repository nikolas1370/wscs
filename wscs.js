const packetMetaSize  =  50;  
const WebSocket = require('ws');
const WebSocketServer = require('ws').WebSocketServer;
var createServer = require("https").createServer;

function Utf8ArrayToStr(array) {  // nodejs 12 нема TextDecode
    var out, i, len, c; // не я писав
    var char2, char3;

    out = "";
    len = array.length;
    i = 0;
    while(i < len) {
        c = array[i++];
        switch(c >> 4)
        {
            case 0: case 1: case 2: case 3: case 4: case 5: case 6: case 7:
            out += String.fromCharCode(c);
            break;
            case 12: case 13:
            char2 = array[i++];
            out += String.fromCharCode(((c & 0x1F) << 6) | (char2 & 0x3F));
            break;
            case 14:
                char2 = array[i++];
                char3 = array[i++];
                out += String.fromCharCode(((c & 0x0F) << 12) |
                    ((char2 & 0x3F) << 6) |
                    ((char3 & 0x3F) << 0));
                break;
        }
    }

    return out;
}

let strToUtf8Array = function (string) { // nodejs 12 нема TextDecode
    var octets = []; // не я писав
    var length = string.length;
    var i = 0;
    while (i < length) {
      var codePoint = string.codePointAt(i);
      var c = 0;
      var bits = 0;
      if (codePoint <= 0x0000007F) {
        c = 0;
        bits = 0x00;
      } else if (codePoint <= 0x000007FF) {
        c = 6;
        bits = 0xC0;
      } else if (codePoint <= 0x0000FFFF) {
        c = 12;
        bits = 0xE0;
      } else if (codePoint <= 0x001FFFFF) {
        c = 18;
        bits = 0xF0;
      }
      octets.push(bits | (codePoint >> c));
      c -= 6;
      while (c >= 0) {
        octets.push(0x80 | ((codePoint >> c) & 0x3F));
        c -= 6;
      }
      i += codePoint >= 0x10000 ? 2 : 1;
    }

    return new Uint8Array(octets);
  };

class wscs// WebSocketControlerServer
{
/*
  первих 50 байт це назва вхідного повідомлення ( socet.send("назва") )
    51 байт тип отправки  
        0 Number
        1 String
        2 Object
        3 ArrayBuffer (Buffer) 
        4 Boolean
        10 undefined
        11 null
*/
    /**
     * для кожно зєднання визива connect
     * @param {Number} port 
     * @param {Object} ssl 
     * @param {function} connect(Connection) 
     */
    constructor(port, ssl ,connect)
    {      
        if(ssl)
        {
            let server = createServer(ssl);
            this.wsServer = new WebSocketServer({ server: server });
            server.listen(port);

        }
        else
            this.wsServer = new WebSocket.Server({  port:port});       

        this.byteBuf = Buffer.alloc(1);
         
        let timeoutFun =  (ws) => 
        {
            ws.close();
            ws.timeoutt = true;
            ws.eventClose()
        }

        let pong = (ws) =>
        {      
            clearTimeout(ws.pingTimer)
            ws.pingTimer = setTimeout(timeoutFun, 6000, ws);
            ws.send(this.byteBuf);            
        }

        let voidF = () => {}

        this.wsServer.on('connection', (ws) =>
        {
            let events = [] // {event, callback}
            let eventClose =  voidF;// визивається при закриті сокета
            ws.pingTimer = setTimeout(timeoutFun, 6000, ws); // туди іде 500мс там жде 5000мс і 500мс іде сюда

            let on = (event, callback) =>
            {
                for (let i = 0; i < events.length; i++) 
                    if(events[i].event === event)
                        return events[i].callback = callback

                events.push({event: event, callback: callback});
            }

            let removeOn = (event) =>
            {
                for (let i = 0; i < events.length; i++) 
                    if(events[i].event === event)
                        return events.splice(i, 1);
            }

            /**
             * 
             * @param {String} event 
             * @param {String | number | boolean | Object | Buffer | ArrayBuffer | DataView} data 
             * @param {Object} header 
             */
            let send = (event, data, header) =>
            {
                let stringEncodeMoveBuffer = (str) =>
                {
                    data = strToUtf8Array(str)
                    let buf = Buffer.alloc(packetMetaSize + 1 + data.length );
                    for (let i = packetMetaSize + 1 , j = 0; i < buf.byteLength; i++, j++) 
                        buf[i] = data[j] 
                    
                    return buf
                } 
                
                if(data === undefined)
                {
                    var buf = stringEncodeMoveBuffer(String(undefined));
                    buf[packetMetaSize] = 10;
                }
                else if(data === null)
                {
                    var buf = stringEncodeMoveBuffer(String(null));
                    buf[packetMetaSize] = 11;
                }
                else if(typeof(data) === "number")
                {   
                    var buf = stringEncodeMoveBuffer(String(data));    
                    buf[packetMetaSize] = 0;
                }
                else if(typeof(data) === "string")
                {                       
                    var buf = stringEncodeMoveBuffer(data)
                    buf[packetMetaSize] = 1;
                }
                else if(data.constructor.name === "Buffer" || data.constructor.name === "ArrayBuffer" || ArrayBuffer.isView(data))
                {                    
                    if(ArrayBuffer.isView(data))
                        data = Buffer.from(data.buffer);
                    else if(data.constructor.name === "ArrayBuffer")
                        data = Buffer.from(data);
                        
                    let headerStr =  strToUtf8Array(JSON.stringify(typeof(header) === "object" ? header : "{}"))
                    
                    var buf = Buffer.alloc(packetMetaSize + 1 + data.byteLength + 10 +  headerStr.byteLength);
                    let strbl = strToUtf8Array(String(data.byteLength))
                    for (let i = packetMetaSize + 1, j = 0; i < buf.byteLength &&  j < strbl.byteLength; i++, j++) 
                        buf[i] = strbl[j];

                    for (let i = packetMetaSize + 11 , j = 0; i < buf.byteLength; i++, j++) 
                        buf[i] = data[j];
                    
                    for (let i = packetMetaSize + 11 + data.byteLength, j = 0; i < buf.byteLength ; i++, j++) 
                        buf[i] =  headerStr[j]

                    buf[packetMetaSize] = 3;           
                }        
                else if(typeof(data) === "object")
                {   
                    var buf = stringEncodeMoveBuffer(JSON.stringify(data)) 
                    buf[packetMetaSize] = 2;
                }
                else if(typeof(data) === "boolean")
                {
                    var buf = stringEncodeMoveBuffer(String(data));
                    buf[packetMetaSize] = 4;
                }
                else
                {
                    console.log("Нема типу такого");
                    return -1;
                }

                var uint8array = strToUtf8Array(event)
                for (let i = 0 ; i < packetMetaSize ; i++) 
                    buf[i] = (uint8array[i] === undefined? 0: uint8array[i])
                
                ws.send(buf);  
            }            

            ws.on('message', (message) => 
            {                
                if(!message && message.constructor.name !== "ArrayBuffer")
                    return;

                if(message.byteLength < 50) // ping pong 
                    return pong(ws);
                
                let event = Utf8ArrayToStr(message.slice(0, packetMetaSize))   
                let eventBuf = []
                for (let i = 0; i < event.length; i++)
                {
                    if(event[i] !== '\x00')
                        eventBuf.push(event[i])
                    else
                        break                    
                }
                event = eventBuf.join("")
                
                let type =  message[packetMetaSize]
                message = message.slice(packetMetaSize + 1)
                let header;              
                if(type === 0)
                    message = Number(Utf8ArrayToStr(message))
                else if(type === 1)
                    message = Utf8ArrayToStr(message)   
                else if(type === 2)       
                    message = JSON.parse(Utf8ArrayToStr(message));   
                else if(type === 3)
                {
                    let datasize =  Number.parseInt(String(Utf8ArrayToStr(message.slice(0, 10))))
                    message = message.slice(10)
                    let Bmessage =  message.slice(0,datasize);
                    header = JSON.parse(Utf8ArrayToStr(message.slice( datasize)))
                    message = Bmessage;
                }
                else if(type === 4)
                    message = Utf8ArrayToStr(message)  === "true";
                else if(type === 10)
                    message = undefined;
                else if(type === 11)
                    message = null;
                else
                    return console.log("node");;

                for (let i = 0; i < events.length; i++) 
                    if(events[i].event === event)
                        return events[i].callback(message, header)
            });
      
            ws.on('close', (e) =>  
            {      
                clearTimeout(ws.pingTimer); 
                events.length = 0
                if(!ws.timeoutt)
                    eventClose();
            });            
            
            connect(new Connection(on, removeOn, send, (callback) => { eventClose = callback; ws.eventClose = callback}));
        });
    }    
}

module.exports = wscs;


class Connection
{
    constructor(on, removeOn, send, setEventClose)
    {
        this.on = on;
        this.removeOn = removeOn;
        this.send = send;
        this.setEventClose = setEventClose;
    }
}
