const shortid = require("shortid");
const models = require("../db/models");
const redis = require("../redis");
const Random = require("../Random");
const constants = require("../constants");
const names = require("../json/names");

function getIP(req) {
	return req.headers["x-forwarded-for"] || req.headers["cf-connecting-ip"] || req.connection.remoteAddress;
}

async function verifyLoggedIn(req, ignoreError) {
	if (req.user && req.user.id)
		return req.user.id;
	else if (!ignoreError)
		throw new Error("Not logged in");
}

async function verifyPermissions(...args) {
	var res, userId, perms, rank;

	if (typeof args[0] == "string")
		[userId, perms, rank] = args;
	else 
		[res, userId, perms, rank] = args;

	var hasPermissions = await redis.hasPermissions(userId, perms, rank);

	if (!hasPermissions) {
		if (res) {
			res.status(500);
			res.send("You do not have the required permissions.");
		}
		return false;
	}

	return true;
}

async function verifyPermission(...args) {
	var res, userId, perm, rank;

	if (typeof args[0] == "string" || args[0] == null)
		[userId, perm, rank] = args;
	else
		[res, userId, perm, rank] = args;

	var hasPermission = await redis.hasPermission(userId, perm, rank);

	if (!hasPermission) {
		if (res) {
			res.status(500);
			res.send("You do not have the required permissions.");
		}
		return false;
	}

	return true;
}

function scoreGame(game) {
	var playerAmt = game.players.length;
	var total = game.setup.total;
	return playerAmt * (playerAmt / total);
}

function validProp(prop) {
	return ({})[prop] == null;
}

function capitalize(string) {
	return string.charAt(0).toUpperCase() + string.substring(1);
}

function capitalizeWords(string) {
	string = string.toLowerCase();
	var words = string.split(" ");
	words = words.map(word => capitalize(word));
	return words.join(" ");
}

function timeDisplay(value, minSec, suffix) {
	var unit = "millisecond";

	const units = [
		{
			name: "second",
			scale: 1000
		},
		{
			name: "minute",
			scale: 60
		},
		{
			name: "hour",
			scale: 60
		},
		{
			name: "day",
			scale: 24
		},
		{
			name: "week",
			scale: 7
		},
		{
			name: "year",
			scale: 52
		}
	];

	if (value == Infinity)
		return "forever";

	let i = 0;
	while (i < units.length - 1 && value >= units[i].scale) {
		value /= units[i].scale;
		unit = units[i].name;
		i++;
	}

	if (minSec && unit == "millisecond")
		return "Less than a second";

	value = Math.floor(value);

	if (value > 1)
		unit += "s";

	return `${value} ${unit}${suffix || ""}`;
}

function parseTime(time) {
	const units = {
		"millisecond": 1,
		"second": 1000,
		"minute": 60 * 1000,
		"hour": 60 * 60 * 1000,
		"day": 24 * 60 * 60 * 1000,
		"week": 7 * 24 * 60 * 60 * 1000,
		"month": 4 * 7 * 24 * 60 * 60 * 1000,
		"year": 52 * 7 * 24 * 60 * 60 * 1000,
		"forever": Infinity
	};
	const abbrev = {
		"ms": "millisecond",
		"s": "second",
		"sec": "second",
		"m": "minute",
		"min": "minute",
		"h": "hour",
		"hr": "hour",
		"d": "day",
		"w": "week",
		"mo": "month",
		"mon": "month",
		"y": "year",
		"yr": "year",
		"f": "forever",
		"inf": "forever",
		"infinite": "forever",
		"infinity": "forever",
	};

	time = time.match(/(\d+)\s*([a-zA-Z]+)/);
	
	if (!time)
		return;

	var length = Number(time[1]);
	var unit = time[2];

	if (abbrev[unit])
		unit = abbrev[unit];

	if (!units[unit])
		return;

	return length * units[unit];
}

function verifyGameType(gameType) {
	return constants.gameTypes.indexOf(gameType) != -1;
}

async function createNotification(info, recipients, sockets) {
	if (recipients && !Array.isArray(recipients))
		recipients = [recipients];

	if (!info.global && recipients) {
		for (let recipient of recipients) {
			if (!recipient)
				continue;

			let notification = new models.Notification({
				id: shortid.generate(),
				channelId: info.channel,
				user: recipient,
				isChat: info.isChat || false,
				content: info.content,
				date: !info.isChat ? Date.now() : undefined,
				icon: info.icon,
				link: info.link
			});
			await notification.save();

			if (sockets && sockets[recipient]) {
				sockets[recipient].send("newNotif", {
					notif: notification,
					message: info.message
				});
			}
		}
	}
	else if (info.global) {
		var notification = new models.Notification({
			id: shortid.generate(),
			channelId: info.channel,
			isChat: info.isChat || false,
			global: true,
			content: info.content,
			date: Date.now(),
			icon: info.icon,
			link: info.link
		});
		await notification.save();

		var userFilter = {};

		if (recipients)
			userFilter = { id: { $in: recipients } };

		await models.User.updateMany(
			userFilter, 
			{ $push: { globalNotifs: notif._id } }
		).exec();
	}
}

async function banUser(userId, length, permissions, type, modId) {
	var ban = new models.Ban({
		id: shortid.generate(),
		userId,
		modId,
		expires: length != 0 ? Date.now() + length : 0,
		permissions,
		type,
		auto: modId == null
	});
	await ban.save();
	await redis.cacheUserPermissions(userId);
}

function nameGen() {
	var firstNameIndex = Random.randInt(0, names.length - 1);
	var lastNameIndex = Random.randInt(0, names.length - 1);
	var num = Random.randInt(1, 99);
	return names[firstNameIndex] + names[lastNameIndex] + num;
}

async function rateLimit(userId, type, res) {
	var allowed = await verifyPermission(userId, "noCooldowns") || await redis.rateLimit(userId, type);

	if (!allowed && res) {
		res.status(500);
		res.send(`You can only do this once every ${timeDisplay(constants.rateLimits[type])}.`);
	}

	return allowed;
}

module.exports = {
	getIP,
	verifyLoggedIn,
	verifyPermissions,
	verifyPermission,
	scoreGame,
	validProp,
	capitalize,
	capitalizeWords,
	timeDisplay,
	parseTime,
	verifyGameType,
	createNotification,
	banUser,
	nameGen,
	rateLimit
};