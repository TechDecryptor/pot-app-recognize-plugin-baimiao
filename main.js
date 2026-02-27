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

    const headers = {
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-TW,zh-CN;q=0.9,zh;q=0.8,en-US;q=0.7,en;q=0.6',
        'Origin': 'https://web.baimiaoapp.com',
        'Referer': 'https://web.baimiaoapp.com/',
        'Sec-Ch-Ua': '"Chromium";v="126", "Google Chrome";v="126", "Not-A.Brand";v="8"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'X-Auth-Token': loginToken,
        'X-Auth-Uuid': uuid
    };

    async function login() {
        uuid = crypto.randomUUID();
        headers["X-Auth-Uuid"] = uuid;
        const normalizedUsername = typeof username === "string" ? username.trim() : "";
        const loginType = normalizedUsername.includes("@") ? "email" : "mobile";
        const res = await fetch(url + "/api/user/login", {
            method: 'POST',
            headers: {
                ...headers,
                'X-Auth-Token': '',
                'X-Auth-Uuid': uuid
            },
            body: Body.json({
                username: normalizedUsername,
                password: password,
                type: loginType
            })
        });
        if (res.ok) {
            const result = res.data;
            if (result.data && result.data.token) {
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
            throw `Http Request Error\nHttp Status: ${res.status}\n${JSON.stringify(res.data)}`;
        }
    }

    const uuidRes = await db.select('SELECT * FROM uuid');
    const tokenRes = await db.select('SELECT * FROM token');
    await db.close();

    if (uuidRes.length > 0) {
        uuid = uuidRes[uuidRes.length - 1].uuid;
        headers["X-Auth-Uuid"] = uuid;
    }

    if (tokenRes.length > 0) {
        loginToken = tokenRes[tokenRes.length - 1].token;
        headers["X-Auth-Token"] = loginToken;
    } else {
        await login();
    }

    await fetch(url + "/api/user/announcement", { method: 'GET', headers });
    const anonRes = await fetch(url + "/api/user/login/anonymous", {
        method: 'POST',
        headers
    });

    if (anonRes.ok) {
        const result = anonRes.data;
        if (result.data && result.data.token !== undefined) {
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
        throw `Http Request Error\nHttp Status: ${anonRes.status}\n${JSON.stringify(anonRes.data)}`;
    }

    const permRes = await fetch(url + "/api/perm/single", {
        method: 'POST',
        headers,
        body: Body.json({
            mode: "single",
            version: "v2"
        })
    });

    let engine = "";
    let ocrToken = "";
    if (permRes.ok) {
        const result = permRes.data;
        if (result.data && result.data.engine) {
            engine = result.data.engine;
            ocrToken = result.data.token;
        } else {
            throw "已经达到今日识别上限，请前往白描手机端开通会员或明天再试";
        }
    } else {
        throw `Http Request Error\nHttp Status: ${permRes.status}\n${JSON.stringify(permRes.data)}`;
    }

    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    const imageSize = bytes.length;

    let mimeType = "image/png";
    let extension = "png";
    if (base64.startsWith("/9j/")) {
        mimeType = "image/jpeg";
        extension = "jpeg";
    } else if (base64.startsWith("R0lG")) {
        mimeType = "image/gif";
        extension = "gif";
    } else if (base64.startsWith("UklGR")) {
        mimeType = "image/webp";
        extension = "webp";
    }

    const ossSignRes = await fetch(url + `/api/oss/sign?mime_type=${encodeURIComponent(mimeType)}`, {
        method: 'GET',
        headers
    });

    let ossData = null;
    if (ossSignRes.ok) {
        const result = ossSignRes.data;
        if (result.code === 1 && result.data && result.data.result) {
            ossData = result.data.result;
        } else {
            throw `OSS sign error: ${JSON.stringify(result)}`;
        }
    } else {
        throw `Http Request Error\nHttp Status: ${ossSignRes.status}\n${JSON.stringify(ossSignRes.data)}`;
    }

    const wordArray = CryptoJS.lib.WordArray.create(bytes);
    const hash = CryptoJS.MD5(wordArray).toString(CryptoJS.enc.Hex);

    // pot-app lacks http-multipart, so we build it manually
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);

    function buildMultipartBody(fields, fileField, fileData, fileMime, fileName) {
        let body = '';

        // OSS PostObject requires file field to be last
        for (const [key, value] of Object.entries(fields)) {
            body += `--${boundary}\r\n`;
            body += `Content-Disposition: form-data; name="${key}"\r\n\r\n`;
            body += `${value}\r\n`;
        }

        body += `--${boundary}\r\n`;
        body += `Content-Disposition: form-data; name="${fileField}"; filename="${fileName}"\r\n`;
        body += `Content-Type: ${fileMime}\r\n\r\n`;

        const encoder = new TextEncoder();
        const headerBytes = encoder.encode(body);
        const footerBytes = encoder.encode(`\r\n--${boundary}--\r\n`);

        const combined = new Uint8Array(headerBytes.length + fileData.length + footerBytes.length);
        combined.set(headerBytes, 0);
        combined.set(fileData, headerBytes.length);
        combined.set(footerBytes, headerBytes.length + fileData.length);

        return combined;
    }

    const formFields = {
        'key': ossData.file_key,
        'policy': ossData.policy,
        'x-oss-signature': ossData.signature,
        'x-oss-signature-version': ossData.x_oss_signature_version,
        'x-oss-credential': ossData.x_oss_credential,
        'x-oss-date': ossData.x_oss_date,
        'x-oss-security-token': ossData.security_token,
        'success_action_status': '200'
    };

    const multipartBody = buildMultipartBody(
        formFields,
        'file',
        bytes,
        mimeType,
        `image.${extension}`
    );

    const ossUploadRes = await fetch(ossData.host, {
        method: 'POST',
        headers: {
            'Accept': 'application/json, text/plain, */*',
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Origin': 'https://web.baimiaoapp.com',
            'Referer': 'https://web.baimiaoapp.com/'
        },
        body: Body.bytes(multipartBody)
    });

    if (!ossUploadRes.ok && ossUploadRes.status !== 200) {
        throw `OSS Upload Error\nHttp Status: ${ossUploadRes.status}\n${JSON.stringify(ossUploadRes.data)}`;
    }

    const createdAt = new Date().toISOString();
    const fileName = `pot_screenshot.${extension}`;

    const ocrRes = await fetch(url + `/api/ocr/image/${engine}`, {
        method: 'POST',
        headers,
        body: Body.json({
            token: ocrToken,
            hash: hash,
            name: fileName,
            size: imageSize,
            createdAt: createdAt,
            fileKey: ossData.file_key,
            result: {},
            status: "processing",
            isSuccess: false
        })
    });

    let jobStatusId = "";
    if (ocrRes.ok) {
        const result = ocrRes.data;
        if (result.data && result.data.jobStatusId) {
            jobStatusId = result.data.jobStatusId;
        } else {
            throw JSON.stringify(result);
        }
    } else {
        throw `Http Request Error\nHttp Status: ${ocrRes.status}\n${JSON.stringify(ocrRes.data)}`;
    }

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    while (true) {
        await sleep(200);
        const statusRes = await fetch(url + `/api/ocr/image/${engine}/status`, {
            method: 'GET',
            headers,
            query: {
                jobStatusId: jobStatusId
            }
        });

        if (statusRes.ok) {
            const result = statusRes.data;
            if (!result.data || !result.data.isEnded) {
                continue;
            } else {
                const ocrResult = result.data.ydResp;
                if (ocrResult && ocrResult.words_result) {
                    let text = "";
                    for (const word of ocrResult.words_result) {
                        text += word.words + "\n";
                    }
                    return text.trim();
                } else {
                    throw `OCR result format error: ${JSON.stringify(result)}`;
                }
            }
        } else {
            throw `Http Request Error\nHttp Status: ${statusRes.status}\n${JSON.stringify(statusRes.data)}`;
        }
    }
}
