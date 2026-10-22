# Wallet translation glossary

| English         | Deutsch                  | Español               | Русский              | 简体中文   |
| --------------- | ------------------------ | --------------------- | -------------------- | ---------- |
| recovery phrase | Wiederherstellungsphrase | frase de recuperación | фраза восстановления | 恢复短语   |
| PIN             | PIN                      | PIN                   | PIN                  | PIN        |
| transfer        | Überweisung              | transferencia         | перевод              | 转账       |
| receive         | empfangen                | recibir               | получить             | 收款       |
| account         | Konto                    | cuenta                | аккаунт              | 账户       |
| wallet          | Wallet                   | billetera             | кошелёк              | 钱包       |
| token           | Token                    | token                 | токен                | 代币       |
| network fee     | Netzwerkgebühr           | comisión de red       | комиссия сети        | 网络手续费 |
| Mainnet         | Hauptnetz                | Red principal         | Основная сеть        | 主网       |
| Testnet         | Testnetz                 | Red de prueba         | Тестовая сеть        | 测试网     |
| seed            | Seed                     | semilla               | сид                  | 种子       |

Quanta, QRL, QRL 2.0, MyQRLWallet, addresses and token names/symbols remain unchanged. A seed may be represented by a recovery phrase or a hex seed; preserve the representation named by each security prompt. German uses neutral instructions, Spanish uses tú, and Russian uses вы. Inflect terms naturally within sentences.

Keep warnings complete, including the required action, credential, affected account and consequences of failure. Amounts, dates and numbers retain the wallet's existing formatting.

Network names use the localized production/testing pair in each language, as commonly used in wallet network selectors. German uses Hauptnetz/Testnetz, Spanish Red principal/Red de prueba, Russian Основная сеть/Тестовая сеть, and Simplified Chinese 主网/测试网. Use the same pair in Settings, connection badges and built-in full names. English badges retain MAINNET/TESTNET from the original wallet. Uppercase badge labels where the script has case. Keep QRL, version identifiers and custom network data unchanged.

Reference terminology: [MetaMask German catalog](https://github.com/MetaMask/metamask-extension/blob/main/app/_locales/de/messages.json), [Spanish catalog](https://github.com/MetaMask/metamask-extension/blob/main/app/_locales/es_419/messages.json), [Russian catalog](https://github.com/MetaMask/metamask-extension/blob/main/app/_locales/ru/messages.json), and [Simplified Chinese catalog](https://github.com/MetaMask/metamask-extension/blob/main/app/_locales/zh_CN/messages.json). Wallets also use transliterations in Russian; this wallet consistently uses the localized pair above.

| English          | Deutsch                | Español                | Русский         | 简体中文 |
| ---------------- | ---------------------- | ---------------------- | --------------- | -------- |
| gas              | Gas                    | gas                    | газ             | gas      |
| approval         | Genehmigung            | aprobación             | одобрение       | 批准     |
| confirmation     | Bestätigung            | confirmación           | подтверждение   | 确认     |
| broadcast        | an das Netzwerk senden | difundir               | передать в сеть | 广播     |
| recipient        | Empfänger              | destinatario           | получатель      | 收款人   |
| address book     | Adressbuch             | libreta de direcciones | адресная книга  | 地址簿   |
| signer           | Signer                 | firmante               | модуль подписи  | 签名器   |
| transaction hash | Transaktionshash       | hash de transacción    | хеш транзакции  | 交易哈希 |
| reverted         | rückgängig gemacht     | revertida              | отменена        | 已回滚   |

Approval authorizes a signer request. Broadcast submits a signed transaction to the network. Confirmation records inclusion and the execution outcome. Preserve these separate stages and every instruction to check History or the explorer before sending again. Gas is execution work; a network fee is its monetary cost. Keep technical service reasons verbatim when the wallet does not own their wording. QNS and QRNS names and network identifiers are data.

For account setup, English mnemonic/seed phrase labels refer to the recovery phrase in the glossary. Translate the surrounding UI only: the recovery words, their order, hex bytes (including `0x`), addresses, file contents and user-entered credentials remain unchanged. Wallet-file passwords, transaction PINs, browser extension unlock passwords and device security credentials are distinct credentials. Keep each owner and purpose explicit.

For device credential recovery, preserve every condition: independently usable backups for every wallet, earlier network profiles, keeping all data if any backup is missing, authentication and confirmation before permanent native removal, and retaining the original browser profile until every wallet is recovered. Encrypted and unencrypted wallet downloads must remain distinguishable, and the prohibition on sharing an unencrypted wallet file is absolute.

| English          | Deutsch            | Español                     | Русский                      | 简体中文       |
| ---------------- | ------------------ | --------------------------- | ---------------------------- | -------------- |
| pair             | koppeln            | vincular                    | связать                      | 配对           |
| sign             | signieren          | firmar                      | подписать                    | 签署           |
| typed data       | typisierte Daten   | datos tipados               | типизированные данные        | 类型化数据     |
| signed domain    | signierte Domain   | dominio firmado             | подписываемый домен          | 签署域         |
| chain ID         | Chain-ID           | ID de cadena                | ID цепи                      | 链 ID          |
| raw signed bytes | signierte Rohbytes | bytes firmados sin procesar | исходные подписываемые байты | 签署的原始字节 |

Pairing establishes an encrypted channel and requires a separate account-access approval. Account approval exposes an address. A signing request authorizes the shown bytes or structured payload. Keep these scopes distinct. A signed typed-data domain is part of the signature and may differ from the website origin or connected chain. Preserve both chain identifiers in mismatch warnings, the warning for absent chain binding, and the consequence that a signed challenge can authenticate as the user.

Translate wallet-owned field labels only. DApp-supplied names, origins, addresses, values, message text, field/type names, hex data and canonical JSON retain their exact rendering. Never translate a supplied value just because it matches a UI word. Preserve existing visual-control escaping. The maximum network fee is a total monetary ceiling; the desktop gas minimum is an execution limit floor. Unknown transaction acceptance or confirmation must retain the instruction to check the explorer before sending again. In Simplified Chinese, use 区块浏览器 for a block explorer and 浏览器 for the web browser.
