async function recognize(base64, _lang, options) {
    const { config, utils } = options;
    const { http, CryptoJS, Database } = utils;
    const { fetch, Body } = http;
    const { username, password } = config;
    const url = "https://web.baimiaoapp.com";
    const id = "plugin.com.TechDecryptor.baimiao_ocr";
    let db = await Database.load(`sqlite:plugins/recognize/${id}/account.db`);
    let uuid = "";
    let loginToken = "";

    let headers = {
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Origin': 'https://web.baimiaoapp.com',
        'Priority': 'u=1, i',
        'Referer': 'https://web.baimiaoapp.com/',
        'Sec-Ch-Ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'X-Auth-Token': loginToken,
        'X-Auth-Uuid': uuid
    }

    async function login() {
        uuid = crypto.randomUUID();
        headers["X-Auth-Uuid"] = uuid;
        let res1 = await fetch(url + "/api/user/login", {
            method: 'POST',
            headers: {
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'zh-CN,zh;q=0.9',
                'Origin': 'https://web.baimiaoapp.com',
                'Priority': 'u=1, i',
                'Referer': 'https://web.baimiaoapp.com/',
                'Sec-Ch-Ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
                'Sec-Ch-Ua-Mobile': '?0',
                'Sec-Ch-Ua-Platform': '"Windows"',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                'X-Auth-Token': '',
                'X-Auth-Uuid': uuid
            },
            body: Body.json({
                username: username,
                password: password,
                type: "mobile"
            })
        });
        if (res1.ok) {
            let result = res1.data;
            if (result.data.token) {
                loginToken = result.data.token;
                headers["X-Auth-Token"] = loginToken;
                db = await Database.load(`sqlite:plugins/recognize/${id}/account.db`);
                await db.execute('INSERT into uuid (uuid) VALUES ($1)', [uuid]);
                await db.execute('INSERT into token (token) VALUES ($1)', [loginToken]);
                await db.close();
            } else {
                throw JSON.stringify(result);
            }
        } else {
            throw `Http Request Error\nHttp Status: ${res1.status}\n${JSON.stringify(res1.data)}`;
        }
    }

    let uuidRes = await db.select('SELECT * FROM uuid');
    let tokenRes = await db.select('SELECT * FROM token');
    await db.close();
    if (uuidRes.length > 0) {
        let result = uuidRes[uuidRes.length - 1];
        uuid = result.uuid;
        headers["X-Auth-Uuid"] = uuid;
    }

    if (tokenRes.length > 0) {
        let result = tokenRes[tokenRes.length - 1];
        loginToken = result.token;
        headers["X-Auth-Token"] = loginToken;
    } else {
        await login();
    }
    let res1 = await fetch(url + "/api/user/announcement", {
        method: 'GET',
        headers: headers,
    });
    res1 = await fetch(url + "/api/user/login/anonymous", {
        method: 'POST',
        headers: headers,
    });
    if (res1.ok) {
        let result = res1.data;
        if (result.data.token !== undefined) {
            loginToken = result.data.token;
            if (loginToken === "") {
                await login();
            }
            headers["X-Auth-Token"] = loginToken;
            db = await Database.load(`sqlite:plugins/recognize/${id}/account.db`);
            await db.execute('INSERT into token (token) VALUES ($1)', [loginToken]);
            await db.close();
        } else {
            throw JSON.stringify(result);
        }
    } else {
        throw `Http Request Error\nHttp Status: ${res1.status}\n${JSON.stringify(res1.data)}`;
    }

    let res2 = await fetch(url + "/api/perm/single", {
        method: 'POST',
        headers: headers,
        body: Body.json({
            mode: "single"
        })
    });

    let engine = "";
    let token = "";
    if (res2.ok) {
        let result = res2.data;
        if (result.data.engine) {
            engine = result.data.engine;
            token = result.data.token;
        } else {
            throw "已经达到今日识别上限，请前往白描手机端开通会员或明天再试";
        }
    } else {
        throw `Http Request Error\nHttp Status: ${res2.status}\n${JSON.stringify(res2.data)}`;
    }

    let hash = CryptoJS.SHA1(`data:image/png;base64,${base64}`).toString(CryptoJS.enc.Hex);

    let res3 = await fetch(url + `/api/ocr/image/${engine}`, {
        method: 'POST',
        headers: headers,
        body: Body.json({
            "batchId": "",
            "total": 1,
            "token": token,
            "hash": hash,
            "name": "pot_screenshot_cut.png",
            "size": 0,
            "dataUrl": `data:image/png;base64,${base64}`,
            "result": {},
            "status": "processing",
            "isSuccess": false
        })
    });
    let jobStatusId = "";
    if (res3.ok) {
        let result = res3.data;
        if (result.data.jobStatusId) {
            hash = result.data.hash;
            jobStatusId = result.data.jobStatusId;
        } else {
            throw JSON.stringify(result);
        }
    } else {
        throw `Http Request Error\nHttp Status: ${res3.status}\n${JSON.stringify(res3.data)}`;
    }

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    while (true) {
        await sleep(100);
        let res4 = await fetch(url + `/api/ocr/image/${engine}/status`, {
            method: 'GET',
            headers: headers,
            query: {
                jobStatusId: jobStatusId
            }
        });
        if (res4.ok) {
            let result = res4.data;
            if (!result.data.isEnded) {
                continue;
            } else {
                let res = result.data.ydResp;
                let words = res.words_result;
                let text = "";
                for (let i of words) {
                    text += i.words;
                    text += "\n";
                }
                return text;
            }
        } else {
            throw `Http Request Error\nHttp Status: ${res4.status}\n${JSON.stringify(res4.data)}`;
        }
    }
}
