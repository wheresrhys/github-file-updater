const fetch = require('node-fetch');

const log = it => {
	console.log(it)
	return it;
}

const logError = it => {
	console.log(it)
	throw it;
}

const eTagCache = {};

const fetchJson = (url, opts) => {
	// TODO support Etags
	opts = opts || {};
	opts.headers = Object.assign(opts.headers || {}, {Authorization: 'token ' + process.env.GITHUB_OAUTH_TOKEN});
	if (eTagCache[url]) {
		opts.headers.etag = eTagCache[url];
	}
	return fetch(url, opts)
		.then(r => {
			eTagCache[url] = r.headers.get('etag');
			return r.json()
		});
}



const fetchFile = (repo, opts) => fetchJson(`https://api.github.com/repos/${repo}/contents/${opts.file}?ref=${opts.branch || 'master'}`)

const getFileAndBranch = (repo, opts) => {

	const promises = [];
	promises.push(fetchFileContents(repo, opts))

	if (opts.branch) {
		promises.push(createBranch(repo, opts))
	} else {
		promises.push(Promise.resolve(null))
	}

	return Promise.all(promises);
}

const createBranch = (repo, opts) => {
	return fetchJson(`https://api.github.com/repos/${repo}/git/refs/heads/master`)
		.then(ref => fetchJson(`https://api.github.com/repos/${repo}/git/refs`, {
			method: 'POST',
			body: JSON.stringify({
			  "ref": "refs/heads/${opts.branch}",
			  "sha": ref.object.sha
			}),
			headers: {
				'Content-Type': 'application/json'
			}
		}))
}

const createPR = (repo, opts) => {
	if (!opts.branch) {
		return;
	}
	return fetchJson(`https://api.github.com/repos/${repo}/pulls`, {
		method: 'POST',
		body: JSON.stringify({
			title: opts.commitMessage,
			body: 'created by github-file-updater',
			head: opts.branch,
			base: 'master'
		})
	}))
}

const createFile = (repo, opts) => {
	const newContents = opts.transform(repo, opts);
	let kickoff = Promise.resolve();
	if (opts.branch) {
		kickoff = createBranch(repo, opts)
	}

	return kickoff
		.then(branch => {
			return fetchJson(`https://api.github.com/repos/${repo}/contents/${opts.path}`, {
				method: 'PUT',
				body: JSON.stringify({
					message: opts.commitMessage,
					content: new Buffer(newContents).toString('base64'),
					branch: opts.branch || 'master'
				})
			})
				.then(() => createPR(repo, opts))
		})
}

const updateFile = (repo, opts) => {

	return getFileAndBranch(repo, opts)
		.then(([contents, branch] => {
			const newContents = opts.transform(new Buffer(contents.content, contents.encoding)).toString(opts.encoding || 'utf8'), repo, opts);
			return fetchJson(`https://api.github.com/repos/${repo}/contents/${opts.path}`, {
				method: 'PUT',
				body: JSON.stringify({
					message: opts.commitMessage,
					content: new Buffer(newContents).toString('base64'),
					sha: contents.sha,
					branch: opts.branch || 'master'
				})
			})
				.then(() => createPR(repo, opts))
		})))
}

const deleteFile = (repo, opts) => {
	return getFileAndBranch(repo, opts)
		.then(([contents, branch] => {
			return fetchJson(`https://api.github.com/repos/${repo}/contents/${opts.path}`, {
				method: 'DELETE',
				body: JSON.stringify({
					message: opts.commitMessage,
					sha: contents.sha,
					branch: opts.branch || 'master'
				})
			})
				.then(() => createPR(repo, opts))
		})))
}


module.exports = {
	delete: (repos, opts) => {
		return Promise.all(repos.map(repo => deleteFile(repo, opts)))
	},
	create: (repos, opts) => {
		return Promise.all(repos.map(repo => createFile(repo, opts)))
	},
	update: (repos, opts) => {
		return Promise.all(repos.map(repo => updateFile(repo, opts)))
	}
}
