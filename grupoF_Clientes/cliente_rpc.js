const amqp = require("amqplib");
const { randomUUID } = require("crypto");

const URL = "amqps://yychnpmp:GhdH4NfHUJq2kXLFvFCYNqbxV0w8OUcz@campbell.lmq.cloudamqp.com/yychnpmp";

async function llamar(cola, payload, timeout = 10000) {
	const conn = await amqp.connect(URL);
	let timer;
	try {
		const ch = await conn.createChannel();
		const { queue } = await ch.assertQueue("", { exclusive: true });
		const corrId = randomUUID();

		let resolver, rechazar;
		const respuesta = new Promise((res, rej) => {
			resolver = res;
			rechazar = rej;
		});

		await ch.consume(
			queue,
			(msg) => {
				if (msg.properties.correlationId === corrId) {
					resolver(JSON.parse(msg.content.toString()));
				}
			},
			{ noAck: true }
		);

		timer = setTimeout(
			() => rechazar(new Error("El worker no respondió a tiempo")),
			timeout
		);

		ch.sendToQueue(
			cola,
			Buffer.from(payload ? JSON.stringify(payload) : ""),
			{ correlationId: corrId, replyTo: queue, expiration: String(timeout) }
		);

		return await respuesta;
	} finally {
		clearTimeout(timer);
		await conn.close();
	}
}

(async () => {
	console.log(await llamar("cliente.consultar", { id: 1 }));
	console.log(await llamar("clientes.listar"));
})();