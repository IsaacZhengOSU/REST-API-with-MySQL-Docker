var express = require('express');
var app = express();
app.use(express.json());
const createConnectorPool = require('./connector-connector.js');
const createTcpPool = require('./connect-tcp.js');
app.set("port", 8080);

var createPool = async () => {
	if (process.env.INSTANCE_CONNECTION_NAME) {
		// Uses the Cloud SQL Node.js Connector when INSTANCE_CONNECTION_NAME
		// (e.g., project:region:instance) is defined
		if (process.env.DB_IAM_USER) {
			//  Either a DB_USER or a DB_IAM_USER should be defined. If both are
			//  defined, DB_IAM_USER takes precedence
			return createConnectorIAMAuthnPool();
		} else {
			return createConnectorPool();
		}
	} else if (process.env.INSTANCE_HOST) {
		// Use a TCP socket when INSTANCE_HOST (e.g., 127.0.0.1) is defined
		return createTcpPool();
	} else {
		throw 'Set `INSTANCE_CONNECTION_NAME` environment variables.';
	}
};

var ensureSchema = async pool => {
	await pool.query(
		`CREATE TABLE IF NOT EXISTS Businesses (
			id INT AUTO_INCREMENT unique NOT NULL,
			owner_id INT NOT NULL,
			name VARCHAR(50) NOT NULL,
			street_address VARCHAR(100) NOT NULL,
			city VARCHAR(50) NOT NULL,
			state VARCHAR(2) NOT NULL,
			zip_code INT NOT NULL,
			PRIMARY KEY (id)
		);`
	);

	await pool.query(
		`CREATE TABLE IF NOT EXISTS Reviews (
			id INT AUTO_INCREMENT unique NOT NULL,
			user_id INT NOT NULL,
			business_id INT,
			review_text VARCHAR(1000),
			stars INT NOT NULL,
			FOREIGN KEY (business_id)
			REFERENCES Businesses (id)
				ON UPDATE CASCADE
				ON DELETE CASCADE,
			PRIMARY KEY (id)
		);`
	);
	console.log("Ensured that table 'Businesses' and 'Reviews' exists");
};

const createPoolAndEnsureSchema = async () =>
	await createPool()
		.then(async pool => {
			await ensureSchema(pool);
			return pool;
		})
		.catch(err => {
			console.log(err);
			throw err;
		});

let pool;

app.use(async (req, res, next) => {
	if (pool) {
		return next();
	}
	try {
		pool = await createPoolAndEnsureSchema();
		next();
	} catch (err) {
		console.log(err);
		return next(err);
	}
});

/***************************************************************
 * HATEOAS functions
 * *************************************************************/
function getUrlB(req, obj, C_OR_R_OR_O) {
	var ip2 = '://104.155.167.132:8080';
	if (C_OR_R_OR_O === 'c' || C_OR_R_OR_O === 'C') {
		var newUrl = req.protocol + ip2 + req.url + '/' + obj.id;
	} else if (C_OR_R_OR_O === 'r' || C_OR_R_OR_O === 'R') {
		var newUrl = req.protocol + ip2 + req.url;
	} else {
		var newUrl = req.protocol + ip2 + '/businesses/' + obj.id;
	}
	obj.self = newUrl;
	return obj;
}

function getUrlR(req, obj, C_OR_R_OR_O) {
	var ip2 = '://104.155.167.132:8080';
	var updatedObj = {};
	for (prop in obj) {
		if (prop === "business_id") {
			updatedObj["business"] = req.protocol + ip2 + '/businesses/' + obj.business_id;
		} else {
			updatedObj[prop] = obj[prop];
		}
	}
	if (C_OR_R_OR_O === 'c' || C_OR_R_OR_O === 'C') {
		var newUrl = req.protocol + ip2 + req.url + '/' + updatedObj.id;
	} else if (C_OR_R_OR_O === 'r' || C_OR_R_OR_O === 'R') {
		var newUrl = req.protocol + ip2 + req.url;
	} else {
		var newUrl = req.protocol + ip2 + '/reviews/' + updatedObj.id;
	}
	updatedObj.self = newUrl;
	return updatedObj;
}

function getUrlP(req, obj) {
	var ip2 = '://104.155.167.132:8080';
	var newUrl = req.protocol + ip2 + '/businesses/' + obj.id;
	obj.self = newUrl;
	return obj;
}

/***************************************************************
 * Pagination functions
 * *************************************************************/
function Pagination(req, arr, offset) {
	var ip2 = '://104.155.167.132:8080';
	let pagedRes = { "entries": [], "next": "" };
	if (!offset) offset = 0;
	for (let i = 0; i < 3; i++, offset++) {
		if (offset < arr.length) {
			pagedRes.entries.push(arr[offset]);
		} else {
			offset = -1;
			break;
		}
	}
	for (element of pagedRes.entries) {
		element = getUrlP(req, element)
	}
	if (offset > 0) pagedRes.next = req.protocol + ip2 + '/businesses' + '?offset=' + offset + '&limit=3';
	return pagedRes;
}

/*
*
*    ROUTES
*
*/

/***************************************************************
 * Businesses
 * *************************************************************/
// 1. Create a Business
app.post('/businesses', async (req, res) => {
	let oId = parseInt(req.body.owner_id);
	let name = req.body.name;
	let sAddr = req.body.street_address;
	let city = req.body.city;
	let state = req.body.state;
	let zCode = parseInt(req.body.zip_code);
	let query = `INSERT INTO Businesses (owner_id, name, street_address, city, state, zip_code) VALUES (?, ?, ?, ?, ?, ?)`;
	let query1 = `SELECT * FROM Businesses WHERE id = ?`;

	pool = pool || (await createPoolAndEnsureSchema());

	if (Object.keys(req.body).length < 6) {
		errBody = { Error: "The request body is missing at least one of the required attributes" };
		res.status(400).send(errBody).end();
	} else {
		try {
			await pool.query(query, [oId, name, sAddr, city, state, zCode]);
			var lastIdArr = await pool.query(`SELECT LAST_INSERT_ID();`);
			var data = await pool.query(query1, [(Object.values(lastIdArr[0][0]))[0]]);
		} catch (err) { console.log(err); }
		res.status(201).send(getUrlB(req, data[0][0], 'c')).end();
	}
});

// 2. Get a Business
app.get('/businesses/:business_id', async (req, res) => {
	key = parseInt(req.params.business_id);
	let query = `SELECT * FROM Businesses WHERE id = ?`;

	pool = pool || (await createPoolAndEnsureSchema());

	try {
		var data = await pool.query(query, [key])
	} catch (err) { console.log(err); }

	if (data[0].length === 0) {
		errBody = { Error: "No business with this business_id exists" };
		res.status(404).send(errBody).end();
	} else { res.status(200).send(getUrlB(req, data[0][0], 'r')).end(); }

});

// 4. Edit a Business
app.put('/businesses/:business_id', async function (req, res) {
	key = parseInt(req.params.business_id);
	let oId = parseInt(req.body.owner_id);
	let name = req.body.name;
	let sAddr = req.body.street_address;
	let city = req.body.city;
	let state = req.body.state;
	let zCode = parseInt(req.body.zip_code);
	let query = `UPDATE Businesses SET owner_id = ?, name = ?, street_address = ?, city = ?, state = ?, zip_code = ? WHERE id = ?`;
	let query1 = `SELECT * FROM Businesses WHERE id = ?`;

	pool = pool || (await createPoolAndEnsureSchema());

	if (Object.keys(req.body).length < 6) {
		errBody = { Error: "The request body is missing at least one of the required attributes" };
		res.status(400).send(errBody).end();
	} else {
		try {
			await pool.query(query, [oId, name, sAddr, city, state, zCode, key]);
		} catch (err) { console.log(err); }

		var data = await pool.query(query1, [key]);
		if (data[0].length === 0) {
			errBody = { Error: "No business with this business_id exists" };
			res.status(404).send(errBody).end();
		} else { res.status(200).send(getUrlB(req, data[0][0], 'r')).end(); }
	}
});

// 5. Delete a Business
app.delete('/businesses/:business_id', async function (req, res) {
	let key = parseInt(req.params.business_id);
	let query = `SELECT * FROM Businesses WHERE id = ?`;
	let query1 = `DELETE FROM Businesses WHERE id = ?`;

	pool = pool || (await createPoolAndEnsureSchema());

	try {
		var data = await pool.query(query, [key]);
		if (data[0].length === 0) {
			// send 404 with error info if entry not found
			errBody = { Error: "No business with this business_id exists" };
			res.status(404).send(errBody).end();
		} else {
			await pool.query(query1, [key]);
			res.sendStatus(204).end();
		}
	} catch (err) { console.log(err); }
});

// 5. List all Businesses
app.get('/businesses', async (req, res) => {
	let offs = parseInt(req.query.offset);
	let query = `SELECT * FROM Businesses ORDER BY id ASC`;

	pool = pool || (await createPoolAndEnsureSchema());

	try {
		var data = await pool.query(query);
	} catch (err) {
		console.log(err);
		res.status(500).send("Unable to get entry").end();
	};
	var pagedRes = Pagination(req, data[0], offs)
	res.status(200).send(pagedRes).end();
});

// 6. List all Businesses for an Owner
app.get('/owners/:owner_id/businesses', async (req, res) => {
	let key = parseInt(req.params.owner_id);
	let query = `SELECT * FROM Businesses WHERE owner_id = ?`;

	pool = pool || (await createPoolAndEnsureSchema());

	try {
		var data = await pool.query(query, [key]);
		if (data[0].length !== 0) {
			for (element of data[0]) {
				element = getUrlB(req, element, 'o');
			}
		} else data[0] = '';
	} catch (err) { console.log(err); }
	res.status(200).send(data[0]).end();
});

/***************************************************************
 * Reviews
 * *************************************************************/
// 7. Create a Review
app.post('/reviews', async (req, res, err) => {
	let uId = parseInt(req.body.user_id);
	let bId = parseInt(req.body.business_id);
	let sNum = parseInt(req.body.stars);
	let rText = req.body.review_text;
	let query = `INSERT INTO Reviews (user_id, business_id, stars, review_text) VALUES (?, ?, ?, ?)`;
	let query1 = `SELECT * FROM Reviews WHERE id = ?`;
	let query2 = `SELECT user_id, business_id FROM Reviews WHERE user_id = ? AND business_id = ?`;

	pool = pool || (await createPoolAndEnsureSchema());

	if (!sNum || uId == NaN || bId == NaN) {
		errBody = { Error: "The request body is missing at least one of the required attributes" };
		res.status(400).send(errBody).end();
	} else {
		try {
			var checkDup = await pool.query(query2, [uId, bId]);
			if (checkDup[0].length > 0) {
				errBody = { Error: "You have already submitted a review for this business. You can update your previous review, or delete it and submit a new review" };
				res.status(409).send(errBody).end();
			} else {
				await pool.query(query, [uId, bId, sNum, rText]);
				var lastIdArr = await pool.query(`SELECT LAST_INSERT_ID();`);
				var data = await pool.query(query1, [(Object.values(lastIdArr[0][0]))[0]]);
				var newData = getUrlR(req, data[0][0], 'c');
				if (newData.review_text === null) newData.review_text = "";
				res.status(201).send(newData).end();
			}
		} catch (err) {
			if (err.errno === 1452) {
				errBody = { Error: "No business with this business_id exists" };
				res.status(404).send(errBody).end();
			}
		}
	}
});

// 8. Get a Review
app.get('/reviews/:review_id', async (req, res) => {
	key = parseInt(req.params.review_id);
	let query = `SELECT * FROM Reviews WHERE id = ?`;

	pool = pool || (await createPoolAndEnsureSchema());

	var data = await pool.query(query, [key])

	if (data[0].length === 0) {
		errBody = { Error: "No review with this review_id exists" };
		res.status(404).send(errBody).end();
	} else {
		res.status(200).send(getUrlR(req, data[0][0], 'r')).end();
	}
});

// 9. Edit a Review
app.put('/reviews/:review_id', async function (req, res) {
	key = parseInt(req.params.review_id);
	let sNum = parseInt(req.body.stars);
	let rText = req.body.review_text;
	let query = `UPDATE Reviews SET stars = ?, review_text = ? WHERE id = ?`;
	let query1 = `UPDATE Reviews SET stars = ? WHERE id = ?`;
	let query2 = `SELECT * FROM Reviews WHERE id = ?`;

	pool = pool || (await createPoolAndEnsureSchema());

	if (!sNum) {
		errBody = { Error: "The request body is missing at least one of the required attributes" };
		res.status(400).send(errBody).end();
	} else {
		var data = await pool.query(query2, [key]);
		if (data[0].length === 0) {
			errBody = { Error: "No review with this review_id exists" };
			res.status(404).send(errBody).end();
		} else {
			if (rText != null) await pool.query(query, [sNum, rText, key]);
			else await pool.query(query1, [sNum, key])
			data = await pool.query(query2, [key]);
			res.status(200).send(getUrlR(req, data[0][0], 'r')).end();
		}
	}
});

// 10. Delete a Review
app.delete('/reviews/:review_id', async function (req, res) {
	let key = parseInt(req.params.review_id);
	let query = `SELECT * FROM Reviews WHERE id = ?`;
	let query1 = `DELETE FROM Reviews WHERE id = ?`;

	pool = pool || (await createPoolAndEnsureSchema());

	try {
		var data = await pool.query(query, [key]);
		if (data[0].length === 0) {
			// send 404 with error info if entry not found
			errBody = { Error: "No review with this review_id exists" };
			res.status(404).send(errBody).end();
		} else {
			await pool.query(query1, [key]);
			res.sendStatus(204).end();
		}
	} catch (err) { console.log(err); }
});

// 11. List all Reviews for a User
app.get('/users/:user_id/reviews', async (req, res) => {
	let key = parseInt(req.params.user_id);
	let query = `SELECT * FROM Reviews WHERE user_id = ?`;

	pool = pool || (await createPoolAndEnsureSchema());

	try {
		var data = await pool.query(query, [key]);
		if (data[0].length !== 0) {
			var returnedObj = [];
			for (element of data[0]) {
				element = getUrlR(req, element, 'o');
				returnedObj.push(element)
			}
		} else data[0] = '';
	} catch (err) { console.log(err); }
	res.status(200).send(returnedObj).end();
});


app.listen(8080);
console.log('Express started on local:8080.');
