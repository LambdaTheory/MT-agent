diff --git a/old/.gitignore b/new/.gitignore
index b304631..124b789 100644
--- a/old/.gitignore
+++ b/new/.gitignore
@@ -1,19 +1,7 @@
-node_modules/
-
-.env
-.env.*
 config.json
-
+.env
 .browser-data/
-.daemon.pid
-.daemon.port
-.daemon.token
+.daemon.*
 tasks/
-
+node_modules/
 *.log
-npm-debug.log*
-yarn-debug.log*
-yarn-error.log*
-
-.DS_Store
-Thumbs.db
diff --git a/old/README.md b/new/README.md
index 1e8e1bf..6adbbdd 100644
--- a/old/README.md
+++ b/new/README.md
@@ -9,7 +9,9 @@
 - **鍗曞晢鍝佺粨鏋勮鐩?*锛氭壒閲?spec 鏀寔鍏ㄥ眬 shared setup锛屼篃鏀寔 item 绾?tenancy/spec 瑕嗙洊鎴栧悎骞? - **瑙勬牸绠＄悊**锛氭柊澧?鍒犻櫎瑙勬牸椤广€佸埛鏂拌鏍艰〃
 - **绉熸湡绠＄悊**锛氳缃璧佸ぉ鏁?-- **瀹¤涓庡洖婊?*锛氭搷浣滆褰曘€佸彉鏇存姤鍛娿€佷竴閿洖婊?+- **鍥剧墖绠＄悊 v2**锛氳鍙栧晢鍝佸浘/鐧藉簳鍥俱€佹寜鍒嗙被+鏂囦欢鍚嶉€夋嫨宸叉湁绱犳潗銆佷笂浼犳柊绱犳潗骞跺彲閫夌珛鍗冲洖鍐欍€佽缃鍥俱€佽皟鏁撮『搴?+- **鍟嗗搧澧炲€兼湇鍔?VAS v1**锛氭寜鍞竴鏈嶅姟 ID 缁戝畾鐜版湁鏈嶅姟锛岀鐞嗗紑鍏炽€侀€傜敤骞冲彴銆佹湇鍔￠『搴忓強榛樿/寮哄埗/寮圭獥閫夐」
+- **瀹¤涓庡洖婊?*锛氭搷浣滆褰曘€佸彉鏇存姤鍛娿€佸瓧娈?VAS 鍥炴粴棰勮涓庢樉寮忕‘璁ゆ墽琛? 
 ## 蹇€熷紑濮? 
@@ -24,6 +26,7 @@ node scripts/init.js
 
 # 3. 鍚姩 daemon
 node scripts/playwright-runner.js daemon start
+# 骞惰璋冭瘯鎴栭粯璁?profile 琚叾浠?daemon 鍗犵敤鏃讹紝鍙€氳繃 RENTAL_AGENT_USER_DATA_DIR 鎸囧畾闅旂娴忚鍣ㄧ洰褰? 
 # 4. 鍗曞晢鍝佹敼浠凤紙鍥炲綊娴嬭瘯鍙兘浣跨敤鍟嗗搧 ID 761锛涗笉瑕佹浛鎹㈡垚鍏朵粬鐪熷疄鍟嗗搧锛? echo '{"action":"read","productId":"761"}' > cmd.json
@@ -35,10 +38,110 @@ node scripts/mirror-search.js batch-spec ipod > batch.json
 node scripts/batch-runner.js preview batch.json
 node scripts/batch-runner.js execute batch.json
 
+# 5.1 鍥剧墖鎵瑰鐞嗭紙鍥剧墖鎿嶄綔涓嶆敮鎸?preview锛岄渶鏄惧紡纭锛?+# items[].images 鏀寔 upload / pick / thumbnailFileName / orderedUrls / whiteImage
+# upload 鏀寔 sectionType(thumbs|white) / categoryName / uploadFile / confirmSelection / allowDuplicateFileName
+# pick 鏀寔 skipIfAlreadyPresent锛泈hiteImage 鏀寔 skipIfWhiteImageMatched
+# 绱犳潗搴撻€夋嫨浼氫紭鍏堝皾璇曟悳绱㈡枃浠跺悕锛屽け璐ュ悗鍥為€€鍒嗛〉鎵弿
+# execute 鍓嶅繀椤诲湪 spec.options 涓缃?confirmImageWithoutPreview=true
+# 鎵瑰鐞嗘潯鏁颁細鍙?config.rules.maxBatchSize 闄愬埗
+# 鍥剧墖鎵瑰鐞嗘彁浜ゅ悗浼氳嚜鍔ㄦ墽琛?image-verify锛涘悗缁渶鎵嬪姩瀵?batch state 杩愯 delayed-verify锛屽鏍?thumbs / thumbnail / white 鐨勬寔涔呭寲缁撴灉
+# upload 浼氬厛鎶婄礌鏉愬啓鍏ョ礌鏉愬簱锛涘嵆浣挎渶缁堝晢鍝?submit 澶辫触锛岀礌鏉愪笂浼犱篃涓嶄細鍥炴粴锛屾墍浠ュ疄娴嬪繀椤讳娇鐢ㄥ敮涓€鏂囦欢鍚?+
+# 5.2 鍟嗗搧澧炲€兼湇鍔?VAS锛堟寮忓瓧娈?items[].vas锛?+# 鏈嶅姟鍙兘鎸夊敮涓€ ID 瀹氫綅锛沺review 浼氱湡瀹炶鍙栧晢鍝佺姸鎬佸拰鏈嶅姟鐩綍骞剁敓鎴?diff銆?+# execute 浠呯粦瀹氱幇鏈夋湇鍔★紝涓嶆彁渚涙湇鍔″簱鏂板/缂栬緫/鍒犻櫎锛屼笉璋冪敤 incrementAdd/incrementDel銆?+# skipSubmit=true 浼氫繚鐣?preview state 鍚庢墽琛?discard-current-form锛岄伩鍏?daemon 椤甸潰娈嬬暀鏈彁浜?DOM锛涚粨鏋滃崟鍒椾负 previewOnly锛屼笉鍙備笌 delayed-verify銆乺ollback 鎴栭暅鍍忓洖鍐欍€?+
 # 6. 鍋滄 daemon
 node scripts/playwright-runner.js daemon stop
 ```
 
+## VAS 鎵瑰鐞嗙ず渚?+
+```json
+{
+  "items": [
+    {
+      "productId": 761,
+      "vas": {
+        "enabled": true,
+        "platforms": ["wechat", "h5"],
+        "services": {
+          "upsert": [
+            {
+              "id": "1",
+              "defaultSelected": true,
+              "isForce": false,
+              "isPopup": false,
+              "expectedName": "瀹夊績淇濓紙200鍏冨唴鎹熷潖鐩存帴鍏嶈禂锛?,
+              "expectedMoney": "30.00"
+            }
+          ],
+          "remove": ["8"]
+        }
+      }
+    }
+  ],
+  "options": { "stopOnError": true }
+}
+```
+
+- `services.set` 鏄畬鏁存湁搴忓揩鐓э紱`services.upsert + remove` 鏄箓绛夎ˉ涓侊紝涓ょ妯″紡浜掓枼銆?+- `platforms` 鎸夐泦鍚堟瘮杈冿紝鏈嶅姟鎸夋暟缁勯『搴忔瘮杈冦€傚叧闂?VAS 榛樿淇濈暀骞冲彴鍜屾湇鍔★紝鍙湁 `services.set: []` 鎵嶆竻绌烘湇鍔°€?+- `isPopup=true` 鏈€澶氫竴涓紱`isForce=true` 瑕佹眰 `defaultSelected=true` 涓?`isPopup=false`銆?+- no-op batch item 浼氳鎷掔粷锛涘鏋?item 鏈韩鏃犲瓧娈靛彉鍖栵紝浣嗗懡涓簡 shared setup锛宻hared setup 浠嶇畻鏈夋晥鎿嶄綔銆?+- `preview` 鐪熷疄鎵ц `vas-read 鈫?vas-catalog-read 鈫?buildTarget/validate/diff`锛屼笉鎻愪緵缁曡繃棰勮鐨?`confirmVASWithoutPreview`锛涙墍鏈夊竷灏旈€夐」蹇呴』浣跨敤 JSON boolean锛宍platforms` 涓?`services.set/upsert/remove` 蹇呴』浣跨敤鏁扮粍锛岀被鍨嬮敊璇細闃绘柇鎵ц銆傚伐浣滄祦瑕佹眰鍏堢粰 agent/operator 鐪嬮瑙堝苟鎷垮埌鏄惧紡纭锛屼絾 batch execute 娌℃湁缁熶竴鐨勭‘璁?token 鎴栧伐浠舵牎楠岋紝鍙湁 form setup 鍜?image 璺緞瀛樺湪鏄惧紡鎵ц寮€鍏炽€?+- `execute` 鍦ㄥ浘鐗囦箣鍚庡簲鐢ㄥ畬鏁?`expectedVAS`锛屼笌瀛楁/鍥剧墖鍙彁浜や竴娆★紱鎻愪氦鍚庣珛鍗?`vas-verify`銆?+- `delayed-verify` 浣跨敤 state 涓墽琛屾椂纭畾鐨?`vasExpected`锛屼笉浼氫粠鍘熷 patch 閲嶆柊鎺ㄥ銆?+- `rollback` 鐩存帴浣跨敤 state 涓繚瀛樼殑瀹屾暣 `vasBefore` 蹇収鎭㈠锛屼笉渚濊禆褰撳墠鏈嶅姟搴撻噸寤猴紱鍊欓€夎鐩栧凡鎻愪氦鐨?`completed` 涓?`verifyFailed`锛屾槑纭帓闄ゆ湭鎻愪氦鐨?`previewOnly`銆傚瓧娈靛洖婊氬拰鍏跺洖璇诲潎鍙鐩栧彲鎭㈠鐨勫瓧娈碉紝骞舵敮鎸佷换鎰?`rent{N}day` 鍔ㄦ€佺鏈熴€?+- rollback preview 涓?rollback --confirm 鍙墽琛屽悓鏃跺叿澶囧瓧娈垫垨 VAS 鎭㈠鏁版嵁鐨勫€欓€夛紱鑻ヨ繃婊ゅ悗涓虹┖鍒欑洿鎺ュけ璐ャ€俽ollback 楠岃瘉瑕佹眰闈為浂瀛楁鏍￠獙鎴栦弗鏍?VAS 璇佹嵁锛岀粷涓嶄細鎶?unsupported-only 鍊欓€夋姤鎴?`0/0` 鎴愬姛銆傚浘鐗?/ spec / tenancy rollback 褰撳墠鏈疄鐜帮紝涓嶆敮鎸佺殑鍊欓€変細琚帓闄ゃ€?+- 绗竴鐗堝彧绠＄悊鍟嗗搧涓庣幇鏈夋湇鍔＄殑缁戝畾锛岀姝㈡湇鍔″簱 CRUD锛屼笉璋冪敤 `incrementAdd`銆乣incrementDel`銆?+- daemon 妯″紡涓嬬殑 `submit` 鐜板湪瑕佹眰 `expectedProductId`锛屽苟鏍￠獙褰撳墠椤垫槸 canonical 鍟嗗搧缂栬緫椤碉細姝ｆ暣鏁板晢鍝?ID銆侀鏈?origin/path銆乣r=goods.edit`銆乣id=<expectedProductId>` 閮藉繀椤诲尮閰嶃€?+- 鍥剧墖涓?VAS 鐨勫綋鍓嶉〉瀵艰埅涔熶細鍦ㄥ埌杈剧洰鏍囧晢鍝佸悗鍐嶆鏍￠獙 canonical 褰撳墠椤碉紝鍐嶈繘琛屼换浣?DOM 淇敼銆?+- submit 鍝嶅簲瑙傚療鍣ㄥ湪鐐瑰嚮鍓嶇珛鍗?arm锛屽彧閲囬泦鐐瑰嚮鍚庣殑鍖归厤 AJAX 鍝嶅簲锛涗細閿佸畾棣栦釜涓庣偣鍑诲叧鑱旂殑鍖归厤淇濆瓨璇锋眰 identity锛屽悗缁笉鍚?identity 鐨勫尮閰嶈姹備細琚拷鐣ワ紱瀹屾垚鍚?cleanup/disarm锛岀偣鍑诲墠鏃у搷搴斾細琚拷鐣ャ€?+- submit 鐐瑰嚮搴忓垪鍏堟墽琛岃瀵熷櫒鍏抽棴鐘舵€佷笅鐨勬粴鍔?棰勬 `trial`锛屽啀 arm 瑙傚療鍣ㄥ苟绔嬪埢鎵ц `force` 娲惧彂锛沗trial` 澶辫触浠嶅睘 pre-dispatch锛屾渶澶氬厑璁稿崟娆￠噸璇曪紝`force` timeout 浠嶅睘 ambiguous 涓斾笉閲嶈瘯銆?+- 鍙湁鏄惧紡鍖归厤鐨?AJAX 涓氬姟鎴愬姛鍝嶅簲鎵嶄細鐩存帴杩斿洖 `ok`銆俽edirect銆乁RL 鍙樺寲銆乼oast-only銆?xx銆佺┖鍝嶅簲銆侀檶鐢熷搷搴旈兘淇濈暀涓?`unknown`锛屽繀椤讳緷璧?readback銆?+- short grace 鍙敤浜庣瓑寰呭凡鎹曡幏璇锋眰鐨勬渶缁?body 鎴栧畬鎴?cleanup锛涘悗缁笉鍚岃姹備笉浼氶噸鏂板苟鍏ュ垽瀹氥€傚彧鏈夊凡鎹曡幏璇锋眰鑷繁鐨?pending body 鎵嶄細鍦?timeout 鏃?fail-closed 钀戒负 `unknown`銆?+- malformed銆侀潪瀵硅薄鎴栫己灏戝叧閿姸鎬佸瓧娈电殑 daemon submit 缁撴灉浼氱粺涓€褰掍竴鍖栦负 `unknown`锛屽苟鍙繚鐣欐湁鐣?raw preview銆?+- submit 缁撴灉閲囩敤鏈夌晫閫掑綊銆乫ailure-first 鐨?JSON 妫€鏌ワ紱鍙宓屽 `result` 鎴?`data` 涓嚭鐜版樉寮忓け璐ワ紝灏辫鐩栭《灞?success銆傛埅鏂悗鐨?JSON 棰勮涓嶄細鍗曠嫭閲囩撼 success锛岄櫎闈炴洿鏃╁凡缁忓懡涓樉寮忓け璐ワ紝鍚﹀垯淇濆畧杩斿洖 `unknown`銆?+- 浠撳簱宸查獙璇佺殑 `status=1` / `code=1` 鍙帴鍙椾负涓氬姟鎴愬姛锛涜８ `code=0` / `code=200` 涓嶆帴鍙楋紱宓屽 failure text 浼樺厛鍒ゅ畾澶辫触銆?+- submit 璇佹嵁棰勮鍦ㄥ啓鍏?state 鎴?report 鍓嶄細鍏堣劚鏁忔晱鎰?URL query value锛屽苟鎸?camelCase 涓庡垎闅旂褰掍竴鍖栧悗鐨勬晱鎰?key 缁х画鑴辨晱锛屽彧淇濈暀鏈夌晫 preview锛涜姹?body銆乭eader銆乧ookie 涓嶄細鎸佷箙鍖栥€?+- click timeout 瑙嗕负 dispatch-ambiguous锛氫笉鑷姩閲嶈瘯锛岃繑鍥?`unknown`锛宍submitted=null`銆乣sideEffectPossible=true`銆乣retrySafe=false`銆傚彧鏈?proven pre-dispatch failure 鍏佽鍗曟閲嶈瘯銆?+- submit transport exception 濡傛灉鍙戠敓鍦?`submitting` checkpoint 涔嬪悗锛屼細钀戒负 `recovery_required` / `verify_failed`锛屾寜 side-effect-possible 澶勭悊锛屽苟闃绘柇鑷姩浜屾 submit銆?+- batch 鍙兘鍦ㄨ嚦灏戜竴涓€傜敤 readback 鏍￠獙鎴愬姛涓旀病鏈変换浣曞け璐ユ牎楠屾椂锛屾妸鍘熷 `unknown` 淇濆畧瑙ｆ瀽涓烘垚鍔燂紱鍘熷瀹¤鐘舵€佷粛淇濈暀 `unknown`銆?+- batch 浼氬湪 submit command dispatch 鍓嶄繚瀛樻瘡鍟嗗搧 `submitting` checkpoint锛屽湪鎷垮埌 submit 鍝嶅簲鍚庡啀淇濆瓨 `submitted` checkpoint銆俿tate 浼氬湪鍚岀洰褰曞師瀛愯惤鐩橈紝`resume` 浼氶樆姝㈠ `submitting` / `submitted` / `recovery_required` / 寰呬汉宸ユ牳楠屽晢鍝佺殑鑷姩浜屾 submit锛屽苟瑕佹眰鍏堝仛浜哄伐鏍搁獙鎴栨仮澶嶏紱鍙鍒涘缓 recovery锛屽師濮?state 灏变細鏍囪涓?`recovery_required`锛屽嵆浣垮叾浠栧晢鍝佷粛鍦ㄧ户缁紱鐖?`resumed` 缁堟€侀摼璺細闃绘鏃?state replay锛況eport 浼氬 `completed`銆乣verifyFailed`銆乣failed` 鍚屾椂灞曠ず raw submit 涓?resolution銆?+- immediate field verify 閬囧埌 expected changes 浣嗛浂鏍￠獙鏃朵篃浼?fail-closed銆?+- immediate image/VAS verify 涔熻姹備弗鏍肩殑闈為浂绮剧‘璁℃暟銆?+- delayed applicable image/VAS 鍙鍑虹幇 `0/0` 璁℃暟涔熸寜 fail-closed 澶勭悊銆?+- `delayed-verify` 鐜板湪 fail-closed锛氳嚜鍔?readback 鍙鐩栧凡鏀寔鐨勫瓧娈点€佸浘鐗囥€乂AS 鑼冨洿銆俽ead error銆佹病鏈?values銆佸０鏄庝簡 expected fields 浣嗛浂鏍￠獙銆佷粎鍋?tenancy/spec setup 涓旂粨鏋勫瀷 readback 缂哄け瀵艰嚧鐨勯浂鏍￠獙銆侀€傜敤鐨勫浘鐗囨垨 VAS 鏍￠獙缂哄け鎴栫粨鏋勫紓甯搁兘浼氱洿鎺ュけ璐ワ紱image/VAS `verifyResult` 璁℃暟蹇呴』鏄潪璐熸暣鏁颁笖婊¤冻 `total = matched + mismatched`锛屽惁鍒欐寜澶辫触澶勭悊銆?+- `delayed-verify` 涓嶄細鑷姩鎻愬崌 `verifyFailed` / `recovery_required` 鏉＄洰锛屼篃涓嶄細鍦ㄤ粛鏈?unresolved 鏉＄洰鏃舵妸鎵规缃负 `delayed_verified`锛泂ummary/report 浼氭毚闇?unresolved count锛屽苟鎶?`submitting` / `submitted` inFlight 椤硅鍏ヤ笖涓嶉噸澶嶃€?+- batch 缁堟€佷紭鍏堢骇浠?`recovery_required` 涓烘渶楂橈紱閲嶅鎴栭潪娉?product ID 浼氬湪鍏ュ彛鐩存帴鎷掔粷锛沘udit 鍙繚鐣欐湁鐣?response evidence 棰勮銆?+- legacy `verify` 鐢ㄦ硶搴斾负 `verify <productId> <changes.json>`銆?+- legacy `apply <productId> <changes.json> --submit` 鍙湁鍦?apply 鐘舵€佷负 `ok` 鏃舵墠浼氱湡姝ｆ彁浜わ紱`partial` / `error` 鍙褰?skipped submit锛岀粷涓嶄細淇濆瓨椤甸潰銆傝嫢 submit 杩斿洖宓屽 `error` / `unknown`锛岄《灞傜姸鎬佷細鍘熸牱閫忎紶锛屽苟淇濈暀 `sideEffectPossible` / `retrySafe`銆?+- legacy `verify <productId> <changes.json>` 鏀寔 flat 涓庡祵濂?spec-specific change 鏂囦欢锛屽苟鍦?read failure銆佹棤 values銆佺己 spec 鎴栫己瀛楁鏃跺共鍑€澶辫触銆?+- audit report 瀵?`completed`銆乣verifyFailed` 浼氬睍绀?field/image/VAS/recovery 缁嗚妭锛涘 `failed` 浼氬睍绀?raw submit/resolution锛涘悓鏃跺睍绀烘瘡鍟嗗搧 delayed 鍩熻鏁板拰鏈夌晫 response evidence銆?+- rollback preview 涓?rollback --confirm 浣跨敤鍚屼竴濂楄繃婊ゅ€欓€夐泦锛屽寘鍚?`completed` 涓?`verifyFailed`锛屾帓闄?`previewOnly`銆?+- flat `rent{N}day` 闀滃儚鍥炲啓浼氬仛鍔ㄦ€佹槧灏勶紱浠讳竴瀛楁鏃犳硶鏄犲皠鏃舵暣鏉?item 浼氳鎷掔粷锛岄槻姝㈤儴鍒嗗啓鍥炪€傚祵濂?per-SKU writeback 浠嶆樉寮忎笉鏀寔骞惰烦杩囥€?+- 闀滃儚鍥炲啓鐨?guarded contract 鍙湁锛氱姸鎬佸繀椤绘槸 `delayed_verified`锛屼笖蹇呴』甯︽湁鏁堢殑 `delayedVerify.at` 浣滀负 `verified_at`锛涚己澶辨垨闈炴硶鏃堕棿鎴充細鐩存帴鎷掔粷鍐欏洖锛岀粷涓嶄娇鐢ㄥ綋鍓嶆椂闂村厹搴曘€傚啓鍥炴椂甯?`source='saas_verify'`銆備笉鎵胯闀滃儚鍐茬獊鏃堕棿鎴虫鏌ワ紝涔熶笉鎵胯鎶?writeback 鍘嗗彶鍐欏叆 task-store銆?+- `task-store` 鐘舵€佹槸瀹芥澗鐨勬搷浣滆褰曪紝涓嶅仛涓ユ牸鐘舵€佽縼绉绘壙璇猴紱batch-state 鐢熷懡鍛ㄦ湡鍗曠嫭寮哄埗鎵ц锛岀姸鎬佸寘鍚?`running`銆乣stopped`銆乣partial`銆乣completed`銆乣completed_with_mismatch`銆乣recovery_required`銆乣resumed`銆乣delayed_verified`銆乣delayed_verify_partial` 绛夈€?+
+## 褰撳墠楠岃瘉鐘舵€?+
+- `node scripts/run-unit-tests.js` => `104/104`
+- 閫掑綊鎵ц `node --check scripts/**/*.js` => `10/10`
+- `node --check scripts/playwright-runner.js` 閫氳繃
+- `node --check scripts/batch-runner.js` 閫氳繃
+- `node --check scripts/mirror-search.js` 閫氳繃
+- LSP 涓嶅彲鐢紝鍥犱负 `typescript-language-server` 鏈畨瑁?+- 鏈墽琛屼换浣曟祻瑙堝櫒銆丼aaS 鎴?daemon 鎿嶄綔
+
+## 褰撳墠鍓╀綑闄愬埗
+
+- 鑷姩 readback 浠呰鐩栧凡鏀寔鐨勫瓧娈?/ 鍥剧墖 / VAS 鑼冨洿銆備粎鍋?setup 鐨?tenancy/spec 淇敼鏃讹紝鎻愪氦鍚庝粛缂哄皯涓撻棬鐨勭粨鏋勫瀷 readback 鏍￠獙锛宒elayed-verify 鍦ㄨ繖绫荤粨鏋勬牎楠岀己澶辨椂缁х画 fail-closed銆?+- `skipSubmit` + 鍥剧墖涓婁紶浠嶅彲鑳藉湪绱犳潗搴撶暀涓嬪壇浣滅敤锛屼笖鏃╅€€璺緞鐨勬竻鐞嗗苟涓嶄繚璇佸鎵€鏈夊垎鏀兘瀹屽叏瑕嗙洊銆?+- live 鍟嗗搧 653 浠嶉渶鎶撳埌 submit 瀵瑰簲 POST 鐨勭簿纭?URL銆乻tatus銆乧ontent-type 鍜?body锛屾墠鑳藉甯冮棶棰樺交搴曞叧闂€?+
 ## 鏋舵瀯
 
 ```
@@ -56,7 +159,8 @@ rental-price-agent/
 鈹?  鈹溾攢鈹€ run-tests.sh            # 鍥炲綊娴嬭瘯
 鈹?  鈹斺攢鈹€ lib/
 鈹?      鈹溾攢鈹€ config-loader.js    # 閰嶇疆鍔犺浇锛堝惈 .env 瑙ｆ瀽锛?-鈹?      鈹斺攢鈹€ rule-checker.js     # 瑙勫垯鏍￠獙
+鈹?      鈹溾攢鈹€ rule-checker.js     # 瑙勫垯鏍￠獙
+鈹?      鈹斺攢鈹€ vas-model.js        # VAS 瑙勮寖鍖栥€佹牎楠屻€佺洰鏍囩姸鎬併€佹瘮杈冧笌 diff
 鈹斺攢鈹€ references/
     鈹斺攢鈹€ process.md              # 15 姝ユ祦绋嬪弬鑰? ```
@@ -71,8 +175,8 @@ rental-price-agent/
 
 - 鍑嵁瀛樺偍鍦?`.env` 鏂囦欢锛屼笉鍏ュ簱
 - `config.json` 浣跨敤 `${VAR}` 鍗犱綅绗︼紝杩愯鏃朵粠鐜鍙橀噺瑙ｆ瀽
-- 鎵€鏈夊啓鎿嶄綔闇€棰勮纭鍚庢墠鎵ц
-- 姣忔淇敼鍚庤嚜鍔ㄥ洖璇婚獙璇?+- 宸ヤ綔娴佽姹傚厛棰勮骞舵嬁鍒版樉寮忕‘璁ゅ悗鍐嶆墽琛岋紝浣?batch execute 娌℃湁缁熶竴鐨勭‘璁?token 鎴栧伐浠舵牎楠岋紝鍙湁 form setup 鍜?image 璺緞瀛樺湪鏄惧紡鎵ц寮€鍏?+- 鑷姩鍥炶楠岃瘉浠呰鐩栧凡鏀寔鐨勫瓧娈?/ 鍥剧墖 / VAS 鑼冨洿锛宼enancy/spec-only 缁撴瀯淇敼浠嶇己灏戜笓闂?readback锛屽苟鍦?delayed-verify 涓?fail-closed
 
 ## License
 
diff --git a/old/SKILL.md b/new/SKILL.md
index 3f9ad77..982e56b 100644
--- a/old/SKILL.md
+++ b/new/SKILL.md
@@ -13,9 +13,11 @@ agent_created: true
 # Rental Price Agent
 
 Operate a SaaS rental platform backend via Playwright browser automation to modify
-product pricing, inventory, and SKUs. The agent acts as an orchestrator, not a
-black-box automator 鈥?every modification requires user confirmation before
-execution.
+product pricing, inventory, and SKUs. Act as an orchestrator, not a black-box
+automator. Show preview evidence and get explicit operator confirmation before
+proceeding with previewable changes. Do not claim a universal execute token or
+artifact for every modification, because only form setup and image paths have
+explicit execution flags.
 
 ## Core Principle
 
@@ -40,7 +42,8 @@ rental-price-agent/
 鈹?  鈹溾攢鈹€ run-tests.sh            # Regression test suite
 鈹?  鈹斺攢鈹€ lib/
 鈹?      鈹溾攢鈹€ config-loader.js    # Shared config + .env loader
-鈹?      鈹斺攢鈹€ rule-checker.js     # Shared price/stock rule validator
+鈹?      鈹溾攢鈹€ rule-checker.js     # Shared price/stock rule validator
+鈹?      鈹斺攢鈹€ vas-model.js        # VAS normalize/validate/target/compare/diff
 鈹斺攢鈹€ references/
     鈹斺攢鈹€ process.md              # 15-step process reference
 ```
@@ -78,8 +81,8 @@ auto-initializes the browser on first command and auto-logins when needed.
 | `login` | 鈥?| Login to SaaS |
 | `read` | `productId`, `fields`? | Read field values from product page. Optional `fields` array to filter. |
 | `apply` | `productId`, `changesFile` | Fill form fields from a changes JSON file (navigates to product) |
-| `apply-current` | `changesFile` | Fill form fields on current page (no navigation 鈥?use after spec changes) |
-| `submit` | 鈥?| Click save button on current page |
+| `apply-current` | `changesFile`, `allowCurrentPage=true`, `expectedProductId` | Fill form fields on the current protected page without navigation (use after spec changes) |
+| `submit` | `expectedProductId` | Click save button on current page after confirming the page product ID |
 | `navigate` | `productId` | Navigate to product detail page |
 | `spec-discover` | `productId` | List all spec dimensions and items |
 | `spec-add-item` | `productId`, `specDimId`, `itemTitle` | Add a spec item to a dimension |
@@ -93,6 +96,17 @@ auto-initializes the browser on first command and auto-logins when needed.
 | `copy` | `productId` | Copy product: search 鈫?click 澶嶅埗 鈫?modal confirm 鈫?save 鈫?return newProductId |
 | `platform-search` | `keyword` | SaaS fallback search: search platform list and return candidate IDs/names/text |
 | `batch-read` | `productIds`, `fields`? | Read multiple product detail pages in parallel, max 3 tabs |
+| `image-read` | `productId` | Read current product image URLs, white image URL, and current order |
+| `image-upload` | `productId`, `sectionType`, `categoryName`, `uploadFile`, `confirmSelection`?, `allowDuplicateFileName`? | Upload one local file into the material library, then optionally confirm it back into the current product form |
+| `image-pick` | `productId`, `categoryName`, `fileNames`, `skipIfAlreadyPresent`? | Open image library, select one or more existing materials by exact file name, confirm, and verify `thumbs[]` URL writeback |
+| `image-order` | `productId`, `orderedUrls` | Reorder current product images by exact URL list and verify `thumbs[]` order |
+| `white-image-set` | `productId`, `categoryName`, `fileName`, `skipIfWhiteImageMatched`? | Open white-image library, select one exact material by file name, confirm, and verify `white_ground_image` URL writeback |
+| `image-verify` | `productId`, `expectedImages` | Verify saved image state (`thumbs[]`, first thumbnail, white image) against expected URLs |
+| `vas-read` | `productId` or `allowCurrentPage`, `expectedProductId` | Read VAS enabled radio, checked platforms, and ordered service hidden inputs |
+| `vas-catalog-read` | `productId`, `ids`?, `keyword`? | POST configured catalog endpoint and return normalized existing services; optional ID filtering |
+| `vas-apply` | `expectedVAS`, current-page protection fields | Apply one complete target VAS state on the current form without submitting |
+| `vas-verify` | `productId`, `expectedVAS` | Re-read the product and compare enabled/platform set/ordered services |
+| `discard-current-form` | `expectedProductId` | Validate the current product, navigate it again, and discard all unsaved form DOM changes |
 
 ### Legacy Single-Invocation Mode
 
@@ -106,9 +120,10 @@ node scripts/playwright-runner.js <action> [args...]
 |---|---|---|
 | `login` | 鈥?| Login |
 | `read` | `<productId>` | Read values |
-| `apply` | `<productId>` `<changes.json>` [`--submit`] | Apply + optionally submit |
+| `image-read` | `<productId>` | Read current product image state |
+| `apply` | `<productId>` `<changes.json>` [`--submit`] | Apply + optionally submit; `--submit` runs only when apply status is `ok` |
 | `submit` | `<productId>` | Click save |
-| `verify` | `<productId>` | Re-read and compare |
+| `verify` | `<productId>` `<changes.json>` | Re-read and compare against the expected changes file |
 | `screenshot` | `<label>` | Take screenshot |
 
 ## Spec & Tenancy Management
@@ -158,7 +173,7 @@ node scripts/batch-runner.js <command> [spec.json]
 | `execute <spec>` | Real execution: serial queue with progress tracking and verify |
 | `resume` | Continue from last checkpoint |
 | `status` | Show current batch progress |
-| `delayed-verify <state>` | Re-read all products and compare with expected values |
+| `delayed-verify <state>` | Re-read all products and compare with expected field values and persisted image state (`thumbs`, first thumbnail, white image) |
 | `report <state>` | Human-readable audit report of a completed batch |
 | `rollback <state>` | Preview reverse changes from a batch state file |
 | `rollback --confirm <state>` | Execute rollback with post-verify |
@@ -171,10 +186,6 @@ node scripts/batch-runner.js <command> [spec.json]
     {
       "productId": 761,
       "fields": { "rent1day": "22.00", "rent10day": "55.00" }
-    },
-    {
-      "productId": 762,
-      "fields": { "rent1day": "25.00" }
     }
   ],
   "shared": {
@@ -185,15 +196,78 @@ node scripts/batch-runner.js <command> [spec.json]
 }
 ```
 
+VAS is a sibling of `fields` and `images`:
+
+```json
+{
+  "items": [
+    {
+      "productId": 761,
+      "vas": {
+        "enabled": true,
+        "platforms": ["wechat", "h5"],
+        "services": {
+          "set": [
+            { "id": "1", "defaultSelected": true, "isForce": false, "isPopup": false }
+          ]
+        }
+      }
+    }
+  ]
+}
+```
+
 - `items[].fields` 鈥?per-product price/stock changes
+- `items[].vas` 鈥?formal per-product VAS field; `valueAddedServices` is accepted only as a compatibility alias.
+  - Services are located only by unique `id`; names are never keys because duplicate names exist.
+  - `services.set` is a complete ordered snapshot. `services.upsert + remove` is an idempotent patch. Set and patch modes are mutually exclusive.
+  - `platforms` is an exact set replacement when present. Service order remains significant.
+  - Closing VAS preserves platforms/services unless `services.set: []` explicitly clears services.
+  - At most one service may use `isPopup=true`. `isForce=true` requires `defaultSelected=true` and `isPopup=false`; omitted `defaultSelected` is inferred as true, explicit false is an error.
+  - `expectedName`/`expectedMoney` may guard an ID against catalog drift and mismatches block execution.
+- `items[].images` 鈥?per-product image operations. Supports:
+  - `upload: { sectionType, categoryName, uploadFile, confirmSelection?, allowDuplicateFileName? }` for uploading one local file into the material library and optionally confirming it into the form immediately
+  - `pick: { categoryName, fileNames[], skipIfAlreadyPresent? }` for appending existing product images by exact file name
+  - `thumbnailFileName` for setting one current-page image as first thumbnail after pick/upload
+  - `orderedUrls[]` for exact image order control (cannot be combined with `thumbnailFileName`)
+  - `whiteImage: { categoryName, fileName, skipIfWhiteImageMatched? }` for white-image selection
+- Image operations now prefer material-library search by file name and fall back to pagination scan when search controls are unavailable or miss the target.
+- After `execute`, image plans run immediate `image-verify` automatically; `delayed-verify <state>` re-checks persisted `thumbs[]`, first thumbnail, and `white_ground_image` against the execution snapshot.
+- Fail closed in `delayed-verify`: automatic readback covers only supported field, image, and VAS scopes. Treat read error, missing values, zero executed checks for declared expected fields, setup-only tenancy/spec flows without structural readback, missing or malformed applicable image/VAS verification blocks, and image/VAS `verifyResult` counts that are missing, nonnumeric, negative, or internally inconsistent as failures.
+- `upload` writes the asset into the material library before the product form is finally submitted. If a later product `submit` fails, the uploaded material is not rolled back, so validation runs must keep file names unique unless duplicates are intentionally allowed.
 - `shared.tenancySet` 鈥?rental periods applied to ALL products
 - `shared.specAddItems` 鈥?spec items added to ALL products
+- Batch size is enforced by `config.rules.maxBatchSize` when configured.
 - `shared` is optional; each item can extend or override with its own `tenancy`/`spec`
 - Item-level setup supports `tenancy.tenancySet`, `spec.specAddItems`, `setup`, `shared`, and `sharedSetup`. Item-level `tenancySet` overrides the global value; item-level `specAddItems` is appended to global `specAddItems` by dimension with de-duplication.
+- Reject no-op batch items. Count shared setup as an effective operation even when the item has no direct field delta.
 - Batch `preview` is blocked when merged setup contains `tenancySet` or `specAddItems`, because ordinary diff cannot safely represent refreshed form structure yet. The preview CLI exits non-zero when this happens. Do not treat old-structure diff as approval for form-level setup.
+- Batch `preview` is also blocked for any `items[].images` plan, because material selection and URL writeback can only be verified on the live form page. A VAS plan on the same item is still genuinely read, catalog-resolved, validated, and diffed.
+- VAS never has a `confirmVASWithoutPreview` bypass. Preview errors block execution.
+- VAS execution order is `vas-read 鈫?vas-catalog-read 鈫?build target/validate 鈫?vas-apply`, after image operations and before the single product submit. Submit is followed by `vas-verify`.
+- `skipSubmit=true` stores before/expected/apply preview evidence and then calls `discard-current-form` after any setup/image/VAS/form DOM change, so the reusable daemon page is not polluted. Such entries are stored as `previewOnly`, not `completed`; they never enter delayed verification, rollback, or mirror writeback.
+- Delayed verification uses the complete `vasExpected` stored during execution. Rollback uses the complete `vasBefore` snapshot and considers committed `completed` plus `verifyFailed` entries, never `previewOnly`. Execute rollback preview and rollback confirm only for candidates that contain field or VAS restore data. This is field/VAS rollback with preview plus explicit confirm, not a broad one-click rollback. Fail when none remain after filtering. Require nonzero field verification or strict VAS evidence. Do not report unsupported-only candidates as `0/0` success. Image/spec/tenancy rollback is not implemented and remains unsupported.
 - Batch `execute` refuses form-level setup unless `options.confirmFormSetupWithoutPreview` is explicitly `true`. Only set it after the user has explicitly accepted that form setup preview is currently blocked.
+- Batch `execute` refuses image operations unless `options.confirmImageWithoutPreview` is explicitly `true`.
 - Form-level actions without `productId` must pass `allowCurrentPage: true` and `expectedProductId`; the daemon rejects current-page operations when the URL product id does not match. This applies to `apply-current`, `tenancy-set`, `spec-add-and-refresh`, `spec-refresh`, `spec-remove-item`, and `spec-remove-dim`.
+- After any image or VAS navigation reaches the target product, validate the canonical current page again before mutating DOM state.
+- Require `expectedProductId` for daemon-mode `submit` as well. Validate a canonical current product page before clicking save: positive integer product ID, expected origin/path, `r=goods.edit`, and `id=<expectedProductId>` must all match.
+- Arm the submit response observer immediately before click. Ignore pre-click responses. Disarm and clean up the observer on completion.
+- Lock the observer to the first click-associated matching save request identity. Ignore later distinct matching save requests. Only the captured request's own pending body may fail closed to `unknown` on timeout.
+- Run submit click in two stages: scroll/preflight `trial` while the observer is disarmed, then arm the observer and immediately dispatch `force`.
+- Return immediate `ok` only for explicit matched AJAX business success. Treat redirect, URL change, toast-only, 3xx, empty response, and unfamiliar response as `unknown` and require readback.
+- Use the short grace window only to wait for the captured request's final body or complete cleanup; do not merge later distinct requests back into the outcome.
+- Normalize malformed, non-object, or missing-status daemon submit results to `unknown` and preserve only a bounded raw preview.
+- Parse submit payloads with bounded recursive failure-first JSON inspection. Any explicit failure nested under `result` or `data` overrides top-level success. Never accept success from a truncated JSON preview alone; if truncation prevents a full decision and no explicit failure was already found, return `unknown`.
+- Accept repository-backed `status=1` / `code=1` as business success. Do not accept bare `code=0` or `code=200`. Let nested failure text dominate.
+- Redact sensitive URL query values before persisting submit evidence previews to batch state or reports. Apply the same protection to sensitive keys after camelCase and separator normalization. Never persist request bodies, headers, or cookies.
+- Treat `trial` failure as pre-dispatch and allow at most one retry. Treat `force` timeout as dispatch-ambiguous: return `unknown` with `submitted=null`, `sideEffectPossible=true`, and `retrySafe=false`, with no automatic retry.
+- If submit transport throws after the `submitting` checkpoint, mark the item `recovery_required` / `verify_failed`, keep `sideEffectPossible=true`, and block automatic re-submit.
+- Resolve batch-level `unknown` only when at least one applicable readback verification succeeds and no verification check fails. Preserve the raw submit audit status even when the final batch result is resolved as successful.
+- Persist a per-product `submitting` checkpoint before submit command dispatch and a `submitted` checkpoint after the submit response arrives. Block automatic re-submit on `resume` for `submitting`, `submitted`, `recovery_required`, or manually gated products. Mark the original state `recovery_required` whenever recovery is created, even if other items still remain. Apply final batch status priority with `recovery_required` highest. Do not auto-promote `verifyFailed` or `recovery_required` entries during delayed verification, and do not set `delayed_verified` while unresolved entries remain. Keep unresolved counts plus raw submit status, bounded response evidence, and readback resolution visible in audit output.
 - `read(fields)` returns `partial`/`error` when a requested selector is not configured, the DOM element is missing, or the field cannot be read.
+- **Dynamic rent field discovery**: Rent period fields (e.g. `rent1day`, `rent10day`, `rent30day`, `rent180day`, or any custom period like `rent45day`) are NOT hardcoded in `config.json`. Instead, `config.selectors.product._dynamicFields.rentDays` defines a scan pattern that discovers all `input.option_rent{N}day_{specId}` inputs present on the page at runtime. When `read` is called without explicit `fields`, all available rent periods are auto-discovered per spec and read. When `apply` receives a `rent{N}day` field, the selector is generated from the template. This means `tenancy-set` can add new periods and they become readable/writable immediately after `spec-refresh` without any config changes.
+- Mirror writeback maps flat `rent{N}day` fields dynamically. Reject the entire item if any flat rent field cannot be mapped. Leave nested per-SKU writeback explicitly unsupported and skipped.
 
 ### Batch Execution Flow
 
@@ -206,8 +280,21 @@ daemon start
 daemon stop
 ```
 
-Progress is saved to `tasks/batches/batch_*_state.json`. Failed products are
-logged; `resume` skips completed ones.
+Progress is saved to `tasks/batches/batch_*_state.json`. Persist a `submitting`
+checkpoint per product before submit command dispatch and a `submitted`
+checkpoint after the submit response. Write state atomically in the same
+directory. Log failed or manually gated products. Skip completed ones on
+`resume`, block automatic re-submit for `submitting` / `submitted` /
+`recovery_required` entries until manual verification or recovery resolves
+them, and preserve parent resumed terminal linkage to prevent replaying the old
+state.
+
+Expose delayed domain counts per product and unresolved entry counts in summary
+and report output. Count `submitting` / `submitted` in-flight entries as
+unresolved without double-counting. Do not mark the batch `delayed_verified`
+while unresolved entries still exist.
+
+Reject duplicate or invalid product IDs before execution starts.
 
 ## Diff Generator
 
@@ -238,6 +325,13 @@ node scripts/task-store.js <action> [args...]
 | `list [status]` | List tasks |
 | `get <taskId>` | Full task details |
 
+Task-store lifecycle is separate from batch-state lifecycle. Use task-store for
+permissive single-operation logging and evidence; do not assume strict
+transition validation there. Use batch-state files for enforced batch control
+flow and recovery. Batch states include `running`, `stopped`, `partial`,
+`completed`, `completed_with_mismatch`, `recovery_required`, `resumed`,
+`delayed_verified`, and `delayed_verify_partial`.
+
 ## Standard Workflow (Single Product)
 
 ```
@@ -249,7 +343,7 @@ node scripts/task-store.js <action> [args...]
 6. diff-generator current.json changes.json  鈫?preview
 7. Show diff table to user 鈫?WAIT FOR CONFIRMATION
 8. apply <productId> changes.json --submit   鈫?fill + save (atomic)
-9. verify <productId>                  鈫?confirm saved values
+9. verify <productId> <changes.json>   鈫?confirm saved values against the expected changes file
 10. task-store create/update            鈫?log operation
 11. daemon stop
 ```
@@ -259,15 +353,19 @@ node scripts/task-store.js <action> [args...]
 ```
 1. daemon start
 2. batch-runner.js preview spec.json   鈫?show all diffs
-3. User confirms entire batch
+3. Agent/operator reviews the preview and records explicit confirmation before execute; do not claim a code-enforced universal confirmation artifact beyond the explicit setup/image flags
 4. batch-runner.js execute spec.json   鈫?serial queue
 5. batch-runner.js status              鈫?check progress
-6. Wait 5 minutes (platform cache delay)
-7. batch-runner.js delayed-verify <state> 鈫?confirm all changes persisted
+6. Wait for the platform cache / persistence window if needed
+7. Manually run batch-runner.js delayed-verify <state> 鈫?confirm all changes persisted
 8. mirror-search.js writeback-state <state> 鈫?update mirror DB only after delayed verification passes
 9. daemon stop
 ```
 
+## VAS Safety Boundary
+
+VAS v1 only binds existing catalog services to a product. It must not expose or call service-library create/update/delete flows, including `incrementAdd` and `incrementDel`. VAS plan booleans must be JSON booleans; `platforms` and `services.set/upsert/remove` must be arrays. Type coercion is forbidden and invalid plan types block before apply. `vas-read` treats missing VAS controls or no checked enabled radio as an error. `vas-apply` accepts a complete `expectedVAS` state, calls the page-native `window.addGoodsIncrement` to rebuild the product binding DOM, applies options in default 鈫?popup 鈫?force order, reads hidden inputs back, and never submits by itself. `vas-verify` also requires a complete validated target state.
+
 ## Error Handling
 
 - **Login failure**: Retry once. If persistent, report and stop.
@@ -275,13 +373,33 @@ node scripts/task-store.js <action> [args...]
 - **Read failure**: If `read` returns no specs/values, treat it as `error`; preview must surface an error diff instead of an empty diff. If explicit `fields` are requested and selectors are missing, return `partial` or `error` with structured warnings/missingFields.
 - **Apply failure**: Stop before submit. Never save a page when `apply` / `apply-current` returns `partial` or `error`.
 - **Form-level setup failure**: `tenancy-set` and `spec-add-and-refresh` must pass all internal checks before apply. Missing popup/table/inputs, failed refresh, missing added spec item, empty refreshed spec rows, or a refreshed spec table that does not include the added item is fatal. When multiple form-level setup steps run in one product flow, only the first step may navigate by productId; subsequent steps must stay on the current unsaved form page.
-- **Submit failure**: If `submit` returns `error`, stop and mark the product failed. If it returns `unknown`, continue readback verification but keep a warning in the result.
-- **Verify mismatch**: Report expected vs actual per field. Let user decide. Missing readback values count as `verify_failed`; `verifyFailed` items must be handled manually or rolled back; delayed verify does not automatically promote them to success.
+- **Submit failure**: If `submit` returns `error`, stop and mark the product failed. If it returns `unknown`, treat it as side-effect-possible, do not auto-retry, continue readback verification, and keep the raw warning in the result. If the unknown came from click timeout, treat it as dispatch-ambiguous with `submitted=null`. Retry only when the failure is proven pre-dispatch.
+- **Verify mismatch**: Report expected vs actual per field. Let user decide. Missing readback values count as `verify_failed`; `verifyFailed` items must be handled manually or rolled back; immediate field verification with expected changes but zero executed checks also fails closed; immediate image/VAS verification also requires strict nonzero exact counts; delayed verify does not automatically promote them to success.
+- **Delayed verification failure**: Automatic readback covers only supported field/image/VAS scopes. Fail closed on read error, no values, declared expected fields with zero executed checks, setup-only tenancy/spec zero-check cases before structural readback exists, delayed applicable image/VAS `0/0` counts, missing/malformed applicable image or VAS verification data, or image/VAS `verifyResult` counts that are not non-negative integers or do not satisfy `total = matched + mismatched`.
+- **Rollback constraints**: Allow rollback only for candidates with field or VAS restore payloads. Exclude unsupported image/spec/tenancy-only candidates. Fail when no supported candidate remains, and require nonzero field verification or strict VAS evidence.
+- **Legacy apply --submit**: Allow the submit phase only when apply status is `ok`. If nested submit returns `error` or `unknown`, propagate that status to the top level and preserve `sideEffectPossible` / `retrySafe`.
+- **Legacy verify**: Accept both flat and nested spec-specific change files. Fail cleanly on read failure, no values, missing specs, or missing fields.
 - **Copy without new ID**: Treat as `unknown` with `sideEffectPossible: true` and `retrySafe: false`. Do not automatically retry because the copied product may already have been created.
 - **Batch-read missing selector**: If the caller explicitly requests fields and a selector is not configured, return `partial` with warnings/missingFields instead of silently omitting the field.
 - **Delist failure**: Treat missing confirmation or product still visible after delist as `error`. 涓嬫灦 is high-risk and must not be considered successful unless the confirmation dialog was actually confirmed and post-check passes.
 - **Batch partial failure**: Failed products logged in state file. `resume` to retry. With `stopOnError`, state remains `stopped` instead of being overwritten to `partial`. Resume writes `resumedTo` on the original state and `resumeFrom` on the new state for audit chaining.
 
+## Current Validation Status
+
+- `node scripts/run-unit-tests.js` => `104/104`
+- Recursive `node --check` across `scripts/**/*.js` => `10/10`
+- `node --check scripts/playwright-runner.js` passed
+- `node --check scripts/batch-runner.js` passed
+- `node --check scripts/mirror-search.js` passed
+- LSP unavailable because `typescript-language-server` is not installed
+- No browser, SaaS, or daemon action was performed
+
+## Current Remaining Limitations
+
+- Automatic readback covers only supported field/image/VAS scopes. Setup-only tenancy/spec modifications still lack dedicated post-submit structural readback, and delayed verification stays fail-closed when that structure check is unavailable.
+- `skipSubmit` + image upload can leave material-library side effects, and cleanup after early returns is not universally guaranteed.
+- Live product 653 still must capture the exact submit POST URL, status, content-type, and body before declaring the issue fully closed.
+
 ## Task States
 
 ```
@@ -294,7 +412,7 @@ planned 鈫?confirmed 鈫?submitted 鈫?verified
 
 - Query mirror by keyword 鈫?get product ID list
 - Multi-match 鈫?present selection table
-- After delayed verify passes 鈫?writeback confirmed values with `source: "saas_verify"` + timestamp
+- After delayed verify passes 鈫?perform guarded writeback of confirmed values with `source: "saas_verify"` and the delayed-verification `verified_at` timestamp. Require a valid `delayedVerify.at`; reject missing or invalid timestamps and never substitute current time. Do not assume mirror conflict timestamp checks or task-store writeback history are implemented.
 
 ## Mirror-Miss Platform Fallback
 
diff --git a/old/config.example.json b/new/config.example.json
index 5fccb79..cccc2e6 100644
--- a/old/config.example.json
+++ b/new/config.example.json
@@ -20,9 +20,6 @@
       "_note": "Selectors use spec item ID (e.g. 3862). Read dynamically from the spec table #options.",
       "goodsName": "input#goodsname",
       "stock": "input.option_stock_{specId}",
-      "rent1day": "input.option_rent1day_{specId}",
-      "rent10day": "input.option_rent10day_{specId}",
-      "rent30day": "input.option_rent30day_{specId}",
       "marketPrice": "input.option_market_price_{specId}",
       "deposit": "input.option_depositprice_{specId}",
       "purchasePrice": "input.option_purchase_price_{specId}",
@@ -30,7 +27,16 @@
       "finalPayment": "input.option_final_payment_{specId}",
       "saveButton": "input.btn.btn-primary[value='淇濆瓨鍟嗗搧']",
       "saveSuccessToast": null,
-      "specTable": "#options table tbody tr"
+      "specTable": "#options table tbody tr",
+      "_dynamicFields": {
+        "rentDays": {
+          "scanSelector": "input[class*='option_rent'][class*='day']",
+          "extractDaysRegex": "option_rent(\\d+)day",
+          "selectorTemplate": "input.option_rent{days}day_{specId}",
+          "fieldTemplate": "rent{days}day",
+          "labelTemplate": "{days}澶╃閲?
+        }
+      }
     },
     "spec": {
       "addSpecBtn": "#add-spec",
@@ -43,16 +49,47 @@
       "specItemTitle": ".spec_item_title",
       "specItemId": ".spec_item_id",
       "specDimTitle": ".spec_title"
+    },
+    "image": {
+      "thumbsButton": "button.BOX_IMG_UPLOAD[box_name='thumbs']",
+      "whiteButton": "button.BOX_IMG_UPLOAD[box_name='white_ground_image']",
+      "thumbsInput": "input[name='thumbs[]']",
+      "whiteInput": "input[name='white_ground_image']",
+      "multiItem": ".multi-item",
+      "deleteButton": ".BOX_IMG_UPLOAD_DELL",
+      "materialCard": "li.box_main_right_img",
+      "materialCardName": ".box_name",
+      "materialCardSelectedClass": "on",
+      "materialCategory": ".box_main_left_title_main",
+      "modalConfirmButton": "span.btn.btn-primary.save",
+      "modalCancelButton": "span.btn.btn-default.cancel",
+      "modalUploadButton": "span.box_uploading_img",
+      "modalFileInput": "input.box_uploading_img_file",
+      "modalSelectAll": "div.box_checkbox",
+      "modalSearchInput": ".box_search input[type='text'], input[name='keywords']",
+      "modalSearchButton": ".box_search .btn, .box_search button, .box_search span",
+      "emptyPlaceholderSrcKeyword": "default-pic.jpg"
+    },
+    "vas": {
+      "enabledRadio": "input[name='is_value_added_services']",
+      "infoSection": ".value_added_services_info",
+      "platformCheckbox": "input[name='appn_arr[]']",
+      "selectButton": "a.select_increment",
+      "list": "#increment_list",
+      "item": "#increment_list .increment_box",
+      "popupCheckbox": ".popupcheck",
+      "defaultCheckbox": ".defaultcheck",
+      "forceCheckbox": "input[onchange*='selectIncrementForce']"
     }
   },
+  "vas": {
+    "catalogEndpoint": "/web/index.php?c=site&a=entry&m=ewei_shopv2&do=web&r=goods.increment.get_increment"
+  },
   "rules": {
     "minPrice": 0,
     "maxPrice": 999999,
     "maxChangePercent": 50,
     "minStock": 0,
-    "confirmOnMultipleMatch": true,
-    "immediateVerify": true,
-    "delayedVerifyMinutes": 5,
     "maxBatchSize": 20
   },
   "taskStorage": {
diff --git a/old/references/process.md b/new/references/process.md
index 6c41cd9..513d369 100644
--- a/old/references/process.md
+++ b/new/references/process.md
@@ -65,6 +65,7 @@ When available:
 #### Step 6 鈥?Generate Modification Diff
 - Compare user's intent with actual page values
 - Calculate: old value, new value, absolute change, percentage change
+- Reject no-op batch items. Count shared setup as an effective operation even when an item has no direct field delta.
 - Apply business rules from `config.rules`:
   - Price floor/ceiling check
   - Max single-change percentage check
@@ -82,7 +83,7 @@ When available:
   | sku   | A001    | A001-B | renamed |
 
 - Highlight rule violations in red
-- **CRITICAL**: Wait for explicit user confirmation. Never skip.
+- **CRITICAL**: Show the preview to the operator and wait for explicit confirmation. Never skip the human approval step. Do not claim a code-enforced universal confirmation token or artifact for every batch path, because only form setup and image execution have explicit flags.
 
 ### Phase 4: Execute the Change
 
@@ -99,14 +100,38 @@ When available:
 
 #### Step 9 鈥?Submit
 - Click the save/submit button
-- Wait for success indicator (toast, redirect, status message)
-- Wait for network idle
+- In daemon mode, require `expectedProductId` and validate a canonical current product page: positive integer product ID, expected origin/path, `r=goods.edit`, and `id=<expectedProductId>` must all match
+- After any image or VAS navigation reaches the target product, validate the same canonical target again before any DOM mutation
+- Arm the response observer immediately before click; ignore pre-click responses; disarm and clean up on completion
+- Lock the observer to the first click-associated matching save request identity and ignore later distinct matching requests
+- Execute submit as scroll/preflight `trial` with the observer disarmed, then arm and immediately dispatch `force`
+- Classify the immediate submit result as `ok`, `error`, or `unknown`
+- Return immediate `ok` only for explicit matched AJAX business success
+- Use the short grace window only to wait for the captured request's final body or finish cleanup; do not merge later distinct requests back into the outcome
+- Normalize malformed, non-object, or missing-status daemon submit results to `unknown` with a bounded raw preview
+- Parse submit payloads with bounded recursive failure-first JSON inspection; any explicit failure nested under `result` or `data` overrides top-level success
+- Never accept success from truncated JSON inspection alone; if the payload preview is truncated and no explicit failure was already found, return `unknown`
+- Accept repository-backed `status=1` / `code=1` as business success; reject bare `code=0` / `code=200`; let nested failure text dominate
+- Redact sensitive URL query values before persisting submit evidence previews to state or reports; also redact sensitive keys after camelCase and separator normalization; never persist request bodies, headers, or cookies
+- Treat redirect, URL change, toast-only, 3xx, empty response, and unfamiliar response as `unknown` that requires readback
+- Treat `trial` failure as pre-dispatch and allow at most one retry
+- Treat `force` timeout as dispatch-ambiguous: do not auto-retry, return `unknown`, set `submitted=null`, `sideEffectPossible=true`, and `retrySafe=false`
+- If submit transport throws after the `submitting` checkpoint, mark the item `recovery_required` / `verify_failed`, treat side effects as possible, and block automatic re-submit
+- Allow one retry only for proven pre-dispatch failure
+- Wait for success indicator evidence when present, then wait for network idle
 - Take a screenshot after submission
 
 #### Step 10 鈥?Immediate Verification
-- Re-read all modified fields from the page
-- Compare with expected values from changes.json
-- Report match/mismatch for each field
+- Persist a per-product `submitting` checkpoint before submit command dispatch
+- Persist a per-product `submitted` checkpoint after the submit response arrives and before starting verification
+- Re-read all supported modified scopes from the page
+- Compare supported field, image, and VAS results with expected values
+- Report match/mismatch for each supported check
+- Fail closed when expected field changes exist but zero field checks actually execute
+- Require immediate image/VAS verification counts to be strict, exact, and nonzero
+- Treat tenancy/spec-only structural changes as outside automatic immediate readback support
+- If raw submit status is `unknown`, resolve it only when at least one applicable readback succeeds and no readback check fails
+- Preserve the raw submit audit status even when readback resolves the final outcome to success
 - If any field does not match:
   - Mark status as `verify_failed`
   - Show expected vs actual
@@ -135,43 +160,80 @@ When available:
 
 ### Phase 6: Delayed Verification
 
-#### Step 13 鈥?Schedule Delayed Check
-- Default delay: 5 minutes (configurable via `config.rules.delayedVerifyMinutes`)
+#### Step 13 鈥?Prepare Delayed Check
+- Delayed verification is a separate manual step; it is **not** auto-scheduled by config.
 - The agent should:
-  1. Create the delayed verification as a pending step
-  2. Sleep/wait for the configured duration
-  3. Then proceed to step 14
+  1. Record the execution state / expected values
+  2. Tell the operator to run delayed verification again after an appropriate wait window
+  3. Then proceed to step 14 when the operator explicitly triggers it
+  4. Mark `recovery_required` when unknown submit state or verification evidence requires manual follow-up instead of automatic re-submit
 
 #### Step 14 鈥?Delayed Verification
 - Navigate to product page fresh
-- Re-read all modified fields
-- Compare with expected values
-- If all match: status 鈫?`delayed_verified`
+- Re-read all supported modified scopes
+- Compare supported field, image, and VAS results with expected values
+- Automatic delayed readback covers only supported field, image, and VAS scopes
+- Fail closed on read error, no values, declared expected fields with zero executed checks, setup-only tenancy/spec zero-check cases before structural readback exists, delayed applicable image/VAS `0/0` counts, missing/malformed applicable image or VAS verification data, or image/VAS `verifyResult` counts that are not non-negative integers or do not satisfy `total = matched + mismatched`
+- Do not auto-promote `verifyFailed` / `recovery_required` entries, and do not set `delayed_verified` while unresolved entries still exist
+- If all match and no unresolved entries remain: status 鈫?`delayed_verified`
 - If any mismatch: status 鈫?`verify_failed`, alert user
 
+### Rollback Scope
+
+- Allow rollback only for candidates that contain field or VAS restore data.
+- Treat rollback as field/VAS rollback with preview plus explicit confirm, not a broad one-click rollback.
+- Exclude unsupported image/spec/tenancy-only candidates from both preview and confirm.
+- Fail rollback preview/confirm when no supported candidate remains after filtering.
+- Require nonzero field verification or strict VAS evidence after rollback.
+- Never report unsupported-only candidates as `0/0` success.
+
 ### Phase 7: Closure
 
-#### Step 15 鈥?Mirror DB Writeback (Future)
-**Not yet implemented in MVP.**
+#### Step 15 鈥?Mirror DB Writeback
 
-When available:
-- Only execute after `delayed_verified`
-- Only update fields that were actually modified
-- Check mirror's `updatedAt` before writing:
-  - If mirror was updated during operation 鈫?merge only modified fields
-  - If mirror is fresher than task start time 鈫?log conflict
-- Mark data source as `saas_verify` with verification timestamp
-- Log writeback in task history
+- Execute guarded writeback only after `delayed_verified`
+- Update only fields that were actually modified
+- Map flat `rent{N}day` fields dynamically. Reject the entire item if any flat rent field is unmappable.
+- Leave nested per-SKU writeback unsupported and skipped.
+- Mark data source as `saas_verify`
+- Record `verified_at` from delayed verification
+- Require a valid `delayedVerify.at` and refuse missing or invalid timestamps; never substitute current time
+- Do not promise mirror conflict timestamp checks or task-store writeback history
 
 #### Step 15 (MVP) 鈥?Final Report
 - Summarize the operation:
   - Product modified
   - Fields changed
   - Old 鈫?new values
+  - Field/image/VAS/recovery details for `completed` and `verifyFailed` entries
+  - Raw submit status and any readback resolution for `failed` entries
+  - Per-product delayed domain counts and unresolved count, including `submitting` / `submitted` in-flight entries without duplicates
+  - Bounded response evidence preview when submit/readback evidence is retained
   - Verification result (immediate and delayed)
   - Any warnings or anomalies
 - Task status reflects final outcome
 
+## State Tracking
+
+- Treat task-store statuses as permissive operation records.
+- Treat batch-state lifecycle as the separately enforced control-flow source.
+
+## Current Validation Status
+
+- `node scripts/run-unit-tests.js` => `104/104`
+- Recursive `node --check` across `scripts/**/*.js` => `10/10`
+- `node --check scripts/playwright-runner.js` passed
+- `node --check scripts/batch-runner.js` passed
+- `node --check scripts/mirror-search.js` passed
+- LSP unavailable because `typescript-language-server` is not installed
+- No browser, SaaS, or daemon action was performed
+
+## Current Remaining Limitations
+
+- Automatic readback covers only supported field/image/VAS scopes. Setup-only tenancy/spec modifications still lack dedicated post-submit structural readback, and delayed verification stays fail-closed when that structure check is unavailable.
+- `skipSubmit` + image upload can leave material-library side effects, and cleanup after early returns is not universally guaranteed.
+- Live product 653 still must capture the exact submit POST URL, status, content-type, and body before declaring the issue fully closed.
+
 ## Task Lifecycle States
 
 ```
@@ -179,7 +241,7 @@ planned
   鈫?confirmed (user approved the diff)
     鈫?submitted (changes saved to platform)
       鈫?immediate_verified (post-save re-read matched)
-        鈫?delayed_verified (5-min check matched)
+        鈫?delayed_verified (manual delayed re-check matched)
       鈫?verify_failed (post-save re-read did not match)
   鈫?cancelled (user rejected or aborted)
 ```
diff --git a/old/scripts/batch-runner.js b/new/scripts/batch-runner.js
index d8331fd..cc01aaf 100644
--- a/old/scripts/batch-runner.js
+++ b/new/scripts/batch-runner.js
@@ -12,8 +12,7 @@
  * Spec format:
  * {
  *   "items": [
- *     { "productId": 761, "fields": { "rent1day": "22.00" } },
- *     { "productId": 762, "fields": { "rent1day": "25.00" } }
+ *     { "productId": 761, "fields": { "rent1day": "22.00" } }
  *   ],
  *   "shared": { "tenancySet": "1,10,30" },
  *   "options": { "stopOnError": true }
@@ -25,11 +24,21 @@ const fs = require("fs");
 const path = require("path");
 const { loadConfig } = require("./lib/config-loader");
 const { checkRules } = require("./lib/rule-checker");
+const {
+  normalizeVASPlan,
+  hasVASOps,
+  validateVASPlan,
+  buildTargetVASState,
+  validateVASTargetState,
+  compareVASState,
+  buildVASDiff,
+} = require("./lib/vas-model");
 
 const SKILL_DIR = path.resolve(__dirname, "..");
 const PORT_FILE = SKILL_DIR + "/.daemon.port";
 const TOKEN_FILE = SKILL_DIR + "/.daemon.token";
 const BATCH_DIR = SKILL_DIR + "/tasks/batches";
+let atomicWriteSequence = 0;
 
 function getDaemonPort() {
   if (!fs.existsSync(PORT_FILE)) return null;
@@ -42,6 +51,57 @@ function die(msg) { process.stderr.write("[batch] ERROR: " + msg + "\n"); proces
 function output(obj) { process.stdout.write(JSON.stringify(obj, null, 2) + "\n"); }
 function readDaemonToken() { return fs.existsSync(TOKEN_FILE) ? fs.readFileSync(TOKEN_FILE, "utf-8").trim() : ""; }
 
+function writeJsonAtomic(filePath, value) {
+  const tempPath = filePath + ".tmp-" + process.pid + "-" + (++atomicWriteSequence);
+  try {
+    fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf-8");
+    fs.renameSync(tempPath, filePath);
+  } catch (err) {
+    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
+    throw err;
+  }
+}
+
+function getMaxBatchSizeFromRules(rules) {
+  const limit = Number(rules && rules.maxBatchSize);
+  return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;
+}
+
+function validateBatchSize(spec, rules = null) {
+  const items = Array.isArray(spec && spec.items) ? spec.items : [];
+  const effectiveRules = rules || ((loadConfig() || {}).rules || {});
+  const maxBatchSize = getMaxBatchSizeFromRules(effectiveRules);
+  if (!maxBatchSize) return { ok: true, count: items.length, maxBatchSize: 0 };
+  if (items.length > maxBatchSize) {
+    return {
+      ok: false,
+      count: items.length,
+      maxBatchSize,
+      message: "Batch item count " + items.length + " exceeds config.rules.maxBatchSize=" + maxBatchSize,
+    };
+  }
+  return { ok: true, count: items.length, maxBatchSize };
+}
+
+function validateBatchItems(spec) {
+  const items = Array.isArray(spec && spec.items) ? spec.items : [];
+  const seen = new Set();
+  for (const item of items) {
+    const productId = String((item && item.productId) ?? "").trim();
+    if (!/^[1-9]\d*$/.test(productId)) return { ok: false, message: "Invalid canonical productId: " + productId };
+    if (seen.has(productId)) return { ok: false, message: "Duplicate productId: " + productId };
+    seen.add(productId);
+    const normalized = normalizeBatchItem(spec, item || {});
+    const hasEffectiveOperation = expectedChangeCount(normalized.changes) > 0
+      || hasFormSetup(normalized.setup)
+      || hasImageOps(normalized.images)
+      || hasVASOps(normalized.vas)
+      || Boolean(normalized.vasSnapshot);
+    if (!hasEffectiveOperation) return { ok: false, message: "No effective operation for productId: " + productId };
+  }
+  return { ok: true, count: items.length };
+}
+
 function isNestedChanges(changes) {
   const firstVal = Object.values(changes || {})[0];
   return typeof firstVal === "object" && firstVal !== null && !Array.isArray(firstVal);
@@ -78,6 +138,357 @@ function compareValues(actualValues, expectedChanges) {
   return { matched, mismatched, checks };
 }
 
+function resolveSubmitByReadback(submitResult, verificationEvidence) {
+  const submitStatus = submitResult && submitResult.status ? submitResult.status : "unknown";
+  if (submitStatus !== "unknown") return { status: submitStatus, resolvedBy: null, scopes: [] };
+  const applicable = (Array.isArray(verificationEvidence) ? verificationEvidence : []).filter(item => item && item.applicable === true);
+  const scopes = [...new Set(applicable.map(item => String(item.scope || "")).filter(Boolean))];
+  const successful = applicable.filter(item => item.status === "ok");
+  const failed = applicable.filter(item => item.status !== "ok");
+  if (successful.length > 0 && failed.length === 0) return { status: "ok", resolvedBy: "readback", scopes };
+  return { status: "verify_failed", resolvedBy: "readback", scopes };
+}
+
+function buildSubmitCommand(productId) {
+  return { action: "submit", expectedProductId: productId };
+}
+
+const SENSITIVE_PREVIEW_KEYS = new Set([
+  "password", "passwd", "pwd", "token", "accesstoken", "refreshtoken",
+  "authorization", "cookie", "setcookie", "csrf", "secret", "apikey",
+  "session", "sessionid", "clientsecret", "authtoken",
+]);
+
+function normalizeSensitivePreviewKey(key) {
+  return String(key || "").toLowerCase().replace(/[^a-z0-9]/g, "");
+}
+
+function isSensitivePreviewKey(key) {
+  return SENSITIVE_PREVIEW_KEYS.has(normalizeSensitivePreviewKey(key));
+}
+
+function redactPreview(value) {
+  let text;
+  try {
+    const parsed = typeof value === "string" ? JSON.parse(value) : value;
+    let nodes = 0;
+    function redactJson(current, depth) {
+      nodes++;
+      if (nodes > 200 || depth > 8) return "[TRUNCATED]";
+      if (Array.isArray(current)) return current.map(item => redactJson(item, depth + 1));
+      if (!current || typeof current !== "object") return current;
+      return Object.fromEntries(Object.entries(current).map(([key, item]) => [
+        key,
+        isSensitivePreviewKey(key) ? "[REDACTED]" : redactJson(item, depth + 1),
+      ]));
+    }
+    const serialized = JSON.stringify(redactJson(parsed, 0));
+    text = serialized === undefined ? String(value) : serialized;
+  } catch {
+    text = String(value === undefined ? "" : value);
+  }
+  text = text.replace(/https?:\/\/[^\s"'<>]+/gi, match => {
+    try {
+      const url = new URL(match);
+      for (const key of [...url.searchParams.keys()]) {
+        if (isSensitivePreviewKey(key)) url.searchParams.set(key, "[REDACTED]");
+      }
+      return url.toString();
+    } catch {
+      return match;
+    }
+  });
+  text = text
+    .replace(/\bBearer\s+[^\s,;"']+/gi, "Bearer [REDACTED]")
+    .replace(/\b(Authorization|Cookie|Set-Cookie)\s*:\s*[^\r\n]+/gi, "$1: [REDACTED]")
+    .replace(/\b([A-Za-z][A-Za-z0-9_-]*)\s*([=:])\s*([^\s&;,]+)/g, (match, key, separator) =>
+      isSensitivePreviewKey(key) ? key + separator + "[REDACTED]" : match);
+  return String(text).replace(/\s+/g, " ").trim().substring(0, 500);
+}
+
+function boundedRawPreview(raw) {
+  return redactPreview(raw);
+}
+
+function normalizeSubmitCommandResult(raw) {
+  const validObject = raw && typeof raw === "object" && !Array.isArray(raw);
+  const status = validObject && typeof raw.status === "string" ? raw.status : "";
+  if (!validObject || !["ok", "error", "unknown"].includes(status)) {
+    return { status: "unknown", submitted: null, sideEffectPossible: true, retrySafe: false, detail: "malformed_submit_response", rawPreview: boundedRawPreview(raw) };
+  }
+  if (status === "unknown") {
+    return { ...raw, submitted: raw.submitted === undefined ? null : raw.submitted, sideEffectPossible: raw.sideEffectPossible !== false, retrySafe: false };
+  }
+  return { ...raw };
+}
+
+function buildSubmitTransportRecovery(result, error) {
+  const detail = "submit_transport_error: " + String(error && error.message || error || "unknown");
+  const submitResult = { status: "unknown", submitted: null, sideEffectPossible: true, retrySafe: false, detail };
+  return {
+    ...result,
+    status: "verify_failed",
+    submitResult,
+    recoveryRequired: true,
+    recoveryPhase: "submitting",
+    automaticResubmitBlocked: true,
+    recoveryMessage: "Submit transport failed after dispatch became possible; manual verification required",
+    steps: [...(result.steps || []), { step: "submit", ...submitResult }],
+  };
+}
+
+function buildPostSubmitVerificationRecovery(result, error) {
+  return {
+    ...result,
+    status: "verify_failed",
+    recoveryRequired: true,
+    recoveryPhase: "verification",
+    automaticResubmitBlocked: true,
+    recoveryMessage: "Post-submit verification transport failed; manual verification required",
+    steps: [...(result.steps || []), { step: "verification-transport-error", status: "error", message: String(error && error.message || error || "unknown") }],
+  };
+}
+
+function buildSubmitAuditSummary(entry) {
+  const raw = entry && entry.submitResult ? entry.submitResult : {};
+  const resolution = entry && entry.submitResolution ? entry.submitResolution : {};
+  const summary = {
+    rawStatus: raw.status || null,
+    rawDetail: raw.detail || "",
+    rawSubmitted: raw.submitted === undefined ? null : raw.submitted,
+    resolutionStatus: resolution.status || null,
+    resolvedBy: resolution.resolvedBy || null,
+    scopes: Array.isArray(resolution.scopes) ? resolution.scopes : [],
+  };
+  const response = raw.response && typeof raw.response === "object" ? raw.response : {};
+  if (response.url || response.httpStatus !== undefined || response.contentType || response.bodyPreview || raw.rawPreview) {
+    summary.responseEvidence = {
+      url: redactPreview(response.url || ""),
+      httpStatus: response.httpStatus === undefined ? null : response.httpStatus,
+      contentType: response.contentType || "",
+      bodyPreview: redactPreview(response.bodyPreview || ""),
+      rawPreview: redactPreview(raw.rawPreview || ""),
+    };
+  }
+  return summary;
+}
+
+function buildSubmitAuditLines(entry, indent = "") {
+  const summary = buildSubmitAuditSummary(entry);
+  const lines = [];
+  if (summary.rawStatus) {
+    lines.push(indent + "Submit raw: status=" + summary.rawStatus + ", submitted=" + (summary.rawSubmitted === null ? "unknown" : summary.rawSubmitted) + ", detail=" + (summary.rawDetail || "N/A"));
+  }
+  if (summary.resolutionStatus) {
+    lines.push(indent + "Submit resolution: status=" + summary.resolutionStatus + ", resolvedBy=" + (summary.resolvedBy || "N/A") + ", scopes=[" + summary.scopes.join(",") + "]");
+  }
+  if (summary.responseEvidence) {
+    const evidence = summary.responseEvidence;
+    lines.push(indent + "Submit response: url=" + (evidence.url || "N/A") + ", httpStatus=" + (evidence.httpStatus === null ? "N/A" : evidence.httpStatus) + ", contentType=" + (evidence.contentType || "N/A") + ", bodyPreview=" + (evidence.bodyPreview || "N/A") + ", rawPreview=" + (evidence.rawPreview || "N/A"));
+  }
+  return lines;
+}
+
+function buildVerificationAuditLines(entry, indent = "") {
+  const lines = [];
+  if (entry && entry.verifyResult) {
+    const verify = entry.verifyResult;
+    lines.push(indent + "Field verify: " + Number(verify.matched || 0) + "/" + Number(verify.total || 0) + " matched, mismatched=" + Number(verify.mismatched || 0));
+    for (const mismatch of verify.mismatches || []) {
+      lines.push(indent + "  " + (mismatch.specId || "(unknown)") + " " + (mismatch.field || "(unknown)") + ": expected " + mismatch.expected + ", got " + mismatch.actual);
+    }
+  }
+  for (const [label, result] of [["Image", entry && entry.imageVerifyResult], ["VAS", entry && entry.vasVerifyResult]]) {
+    if (!result) continue;
+    if (result.verifyResult) {
+      lines.push(indent + label + " verify: status=" + (result.status || "unknown") + ", " + Number(result.verifyResult.matched || 0) + "/" + Number(result.verifyResult.total || 0) + " matched, mismatched=" + Number(result.verifyResult.mismatched || 0));
+    } else {
+      lines.push(indent + label + " verify: status=" + (result.status || "unknown") + ", detail=" + (result.message || "verifyResult unavailable"));
+    }
+  }
+  if (entry && entry.recoveryRequired === true) {
+    lines.push(indent + "Recovery: phase=" + (entry.recoveryPhase || "unknown") + ", automaticResubmitBlocked=" + (entry.automaticResubmitBlocked === true) + ", message=" + (entry.recoveryMessage || "manual verification required"));
+  }
+  return lines;
+}
+
+function buildSubmittingCheckpoint(result) {
+  const snapshot = JSON.parse(JSON.stringify(result));
+  return { productId: result.productId, phase: "submitting", result: snapshot };
+}
+
+function buildSubmittedCheckpoint(result) {
+  const snapshot = JSON.parse(JSON.stringify(result));
+  return { productId: result.productId, phase: "submitted", result: snapshot };
+}
+
+function prepareResumeState(state) {
+  const next = {
+    ...state,
+    completed: [...(state.completed || [])],
+    previewOnly: [...(state.previewOnly || [])],
+    verifyFailed: [...(state.verifyFailed || [])],
+    failed: [...(state.failed || [])],
+  };
+  const recoveryCheckpoint = state.inFlight && ["submitting", "submitted"].includes(state.inFlight.phase) ? state.inFlight : null;
+  if (recoveryCheckpoint) {
+    const recovered = {
+      ...(recoveryCheckpoint.result || {}),
+      productId: recoveryCheckpoint.productId,
+      status: "verify_failed",
+      recoveryRequired: true,
+      recoveryPhase: recoveryCheckpoint.phase,
+      automaticResubmitBlocked: true,
+      recoveryMessage: "Submit side effect was checkpointed before verification; automatic resubmit is blocked",
+    };
+    const alreadyRecorded = [...next.completed, ...next.previewOnly, ...next.verifyFailed, ...next.failed]
+      .some(entry => String(entry.productId) === String(recoveryCheckpoint.productId));
+    if (!alreadyRecorded) next.verifyFailed.push(recovered);
+    next.inFlight = null;
+    next.status = "recovery_required";
+  }
+  const doneIds = new Set([...next.completed, ...next.previewOnly, ...next.verifyFailed, ...next.failed].map(entry => String(entry.productId)));
+  const remainingItems = ((next.spec && next.spec.items) || []).filter(item => !doneIds.has(String(item.productId)));
+  return { state: next, remainingItems };
+}
+
+function expectedChangeCount(expectedChanges) {
+  const expected = expectedChanges || {};
+  if (isNestedChanges(expected)) return Object.values(expected).reduce((total, fields) => total + Object.keys(fields || {}).length, 0);
+  return Object.keys(expected).length;
+}
+
+function evaluateImmediateFieldVerification(actualValues, expectedChanges) {
+  const { matched, mismatched, checks } = compareValues(actualValues || {}, expectedChanges || {});
+  const zeroChecks = expectedChangeCount(expectedChanges) > 0 && checks.length === 0;
+  const failures = zeroChecks
+    ? [{ specId: "(readback)", field: "(all)", expected: "changed fields", actual: "no checks produced", match: false }]
+    : mismatched;
+  return {
+    status: failures.length > 0 ? "failed" : "ok",
+    verifyResult: {
+      total: checks.length + (zeroChecks ? 1 : 0),
+      matched: matched.length,
+      mismatched: failures.length,
+      mismatches: failures,
+    },
+  };
+}
+
+function parseVerificationCounts(verifyResult) {
+  if (!verifyResult || typeof verifyResult !== "object" || Array.isArray(verifyResult)) return null;
+  const keys = ["matched", "mismatched", "total"];
+  if (!keys.every(key => Object.prototype.hasOwnProperty.call(verifyResult, key))) return null;
+  if (!keys.every(key => typeof verifyResult[key] === "number" && Number.isFinite(verifyResult[key]) && Number.isInteger(verifyResult[key]) && verifyResult[key] >= 0)) return null;
+  if (verifyResult.total !== verifyResult.matched + verifyResult.mismatched) return null;
+  return { matched: verifyResult.matched, mismatched: verifyResult.mismatched, total: verifyResult.total };
+}
+
+function evaluateImmediateScopedVerification(response) {
+  const counts = parseVerificationCounts(response && response.verifyResult);
+  if (!response || response.status !== "ok" || !counts || counts.total === 0 || counts.mismatched > 0) {
+    return { status: "failed", verifyResult: counts || null, response: response || null };
+  }
+  return { status: "ok", verifyResult: counts, response };
+}
+
+function deriveDelayedStateStatus(results, unresolvedCount) {
+  const allVerified = Array.isArray(results) && results.length > 0 && results.every(result => result && result.status === "verified");
+  return allVerified && Number(unresolvedCount || 0) === 0 ? "delayed_verified" : "delayed_verify_partial";
+}
+
+function countDelayedUnresolved(state) {
+  const unresolvedIds = new Set((state && state.verifyFailed || []).map(entry => String(entry.productId)));
+  for (const entry of state && state.failed || []) {
+    if (entry && (entry.recoveryRequired === true || entry.automaticResubmitBlocked === true)) unresolvedIds.add(String(entry.productId));
+  }
+  const inFlight = state && state.inFlight;
+  if (inFlight && ["submitting", "submitted"].includes(inFlight.phase)) unresolvedIds.add(String(inFlight.productId ?? "(inFlight)"));
+  return unresolvedIds.size;
+}
+
+function deriveBatchFinalStatus(state, stopped) {
+  const recoveryEntries = [...(state.verifyFailed || []), ...(state.failed || [])]
+    .some(entry => entry && (entry.recoveryRequired === true || entry.automaticResubmitBlocked === true));
+  if (recoveryEntries) return "recovery_required";
+  if (stopped) return "stopped";
+  if ((state.failed || []).length > 0) return "partial";
+  if ((state.verifyFailed || []).length > 0) return "completed_with_mismatch";
+  return "completed";
+}
+
+function isResumableBatchState(state) {
+  if (!state || state.resumedTo) return false;
+  return !["completed", "completed_with_mismatch", "delayed_verified", "resumed"].includes(state.status);
+}
+
+function selectLatestResumableBatchState(candidates) {
+  return [...(candidates || [])].sort((a, b) => Number(b.mtimeMs || 0) - Number(a.mtimeMs || 0)).find(candidate => isResumableBatchState(candidate.state)) || null;
+}
+
+function evaluateDelayedVerification({ readResult, expectedChanges = {}, imageApplicable = false, imageResult = null, vasApplicable = false, vasResult = null, requireAnyCheck = false }) {
+  if (!readResult || readResult.status === "error" || !readResult.values) {
+    return { status: "error", total: 1, passed: 0, failed: 1, checks: [], imageVerify: imageResult, vasVerify: vasResult, error: readResult?.message || "readback returned no values" };
+  }
+  const { checks } = compareValues(readResult.values, expectedChanges);
+  const expectedCount = expectedChangeCount(expectedChanges);
+  const zeroFieldChecks = expectedCount > 0 && checks.length === 0;
+  const fieldPassed = checks.filter(check => check.match).length;
+  let fieldFailed = checks.filter(check => !check.match).length + (zeroFieldChecks ? 1 : 0);
+  let infrastructureError = zeroFieldChecks;
+
+  let imagePassed = 0, imageFailed = 0, imageTotal = 0;
+  if (imageApplicable) {
+    const imageCounts = parseVerificationCounts(imageResult && imageResult.verifyResult);
+    if (!imageResult || imageResult.status === "error" || !imageCounts || imageCounts.total === 0) {
+      imageFailed = 1; imageTotal = 1; infrastructureError = true;
+    } else {
+      imagePassed = imageCounts.matched;
+      imageFailed = imageCounts.mismatched;
+      imageTotal = imageCounts.total;
+      if (imageResult.status !== "ok" && imageFailed === 0) { imageFailed = 1; imageTotal = Math.max(1, imageTotal); }
+    }
+  }
+
+  let vasPassed = 0, vasFailed = 0, vasTotal = 0;
+  if (vasApplicable) {
+    const vasCounts = parseVerificationCounts(vasResult && vasResult.verifyResult);
+    if (!vasResult || vasResult.status === "error" || !vasCounts || vasCounts.total === 0) {
+      vasFailed = 1; vasTotal = 1; infrastructureError = true;
+    } else {
+      vasPassed = vasCounts.matched;
+      vasFailed = vasCounts.mismatched;
+      vasTotal = vasCounts.total;
+      if (vasResult.status !== "ok" && vasFailed === 0) { vasFailed = 1; vasTotal = Math.max(1, vasTotal); }
+    }
+  }
+
+  let total = checks.length + (zeroFieldChecks ? 1 : 0) + imageTotal + vasTotal;
+  if (requireAnyCheck && total === 0) {
+    fieldFailed++;
+    total = 1;
+    infrastructureError = true;
+  }
+  const failed = fieldFailed + imageFailed + vasFailed;
+  return {
+    status: infrastructureError ? "error" : (failed > 0 ? "mismatch" : "verified"),
+    total,
+    passed: fieldPassed + imagePassed + vasPassed,
+    failed,
+    checks,
+    imageVerify: imageResult,
+    vasVerify: vasResult,
+    fieldPassed,
+    fieldFailed,
+    imagePassed,
+    imageFailed,
+    imageTotal,
+    vasPassed,
+    vasFailed,
+    vasTotal,
+  };
+}
+
 function addDiffEntry(diff, warnings, productId, specId, field, oldVal, newVal, rules) {
   if (oldVal === undefined) {
     const entry = {
@@ -195,6 +606,54 @@ function normalizeSetup(setup) {
   return normalized;
 }
 
+function normalizeImagePlan(plan) {
+  if (!isPlainObject(plan)) return {};
+  const normalized = {};
+
+  if (isPlainObject(plan.pick)) {
+    const categoryName = String(plan.pick.categoryName || plan.pick.category || plan.categoryName || "").trim();
+    const fileNames = toList(plan.pick.fileNames !== undefined ? plan.pick.fileNames : plan.pick.files)
+      .map(x => String(x).trim())
+      .filter(Boolean);
+    const skipIfAlreadyPresent = plan.pick.skipIfAlreadyPresent === true || plan.skipIfAlreadyPresent === true;
+    if (fileNames.length > 0) normalized.pick = { categoryName, fileNames, skipIfAlreadyPresent };
+  }
+
+  if (isPlainObject(plan.upload)) {
+    const sectionType = String(plan.upload.sectionType || plan.sectionType || "thumbs").trim() || "thumbs";
+    const categoryName = String(plan.upload.categoryName || plan.upload.category || plan.categoryName || "").trim();
+    const uploadFile = String(plan.upload.uploadFile || plan.upload.file || plan.upload.path || "").trim();
+    const confirmSelection = plan.upload.confirmSelection !== false;
+    const allowDuplicateFileName = plan.upload.allowDuplicateFileName === true;
+    if (uploadFile) normalized.upload = { sectionType, categoryName, uploadFile, confirmSelection, allowDuplicateFileName };
+  }
+
+  if (isPlainObject(plan.whiteImage)) {
+    const categoryName = String(plan.whiteImage.categoryName || plan.whiteImage.category || "").trim();
+    const fileName = String(plan.whiteImage.fileName || plan.whiteImage.name || "").trim();
+    const skipIfWhiteImageMatched = plan.whiteImage.skipIfWhiteImageMatched === true || plan.skipIfWhiteImageMatched === true;
+    if (fileName) normalized.whiteImage = { categoryName, fileName, skipIfWhiteImageMatched };
+  }
+
+  const orderedUrls = toList(plan.orderedUrls || (isPlainObject(plan.order) ? plan.order.orderedUrls : undefined))
+    .map(x => String(x).trim())
+    .filter(Boolean);
+  if (orderedUrls.length > 0) normalized.orderedUrls = orderedUrls;
+
+  const thumbnailFileName = String(plan.thumbnailFileName || (isPlainObject(plan.thumbnail) ? plan.thumbnail.fileName : "") || plan.setFirstFileName || "").trim();
+  if (thumbnailFileName) normalized.thumbnailFileName = thumbnailFileName;
+
+  if (normalized.orderedUrls && normalized.thumbnailFileName) {
+    normalized.invalid = "orderedUrls and thumbnailFileName cannot be used together";
+  }
+
+  return normalized;
+}
+
+function hasImageOps(plan) {
+  return Boolean(plan && (plan.invalid || plan.pick || plan.upload || (plan.orderedUrls && plan.orderedUrls.length > 0) || plan.thumbnailFileName || plan.whiteImage));
+}
+
 function mergeSetup(globalSetup, item) {
   const globalNormalized = normalizeSetup(globalSetup);
   const itemNormalized = normalizeSetup(item);
@@ -215,19 +674,105 @@ function normalizeBatchItem(spec, item) {
     productId: item.productId,
     changes: item.fields || item.changes || {},
     setup: mergeSetup(spec.shared || spec.sharedSetup || {}, item),
+    images: normalizeImagePlan(item.images || item.image || item.imageOps || {}),
+    vas: normalizeVASPlan(item.vas || item.valueAddedServices || {}),
+    vasSnapshot: item.vasSnapshot || null,
   };
 }
 
+function buildRollbackItem(entry) {
+  const reverse = {};
+  const priceFields = new Set(["stock", "marketPrice", "deposit", "purchasePrice", "costPrice", "finalPayment"]);
+  const isRollbackField = field => priceFields.has(field) || /^rent\d+day$/.test(field);
+  const finalValues = entry && entry.finalValues && typeof entry.finalValues === "object" ? entry.finalValues : null;
+  if (entry.currentValues) {
+    for (const [specId, beforeValues] of Object.entries(entry.currentValues)) {
+      const afterValues = finalValues && finalValues[specId] && typeof finalValues[specId] === "object" ? finalValues[specId] : null;
+      const fields = {};
+      for (const [field, beforeVal] of Object.entries(beforeValues)) {
+        if (!isRollbackField(field)) continue;
+        if (!afterValues) continue;
+        const afterVal = afterValues[field];
+        if (afterVal === undefined) continue;
+        if (String(afterVal) !== String(beforeVal)) fields[field] = beforeVal;
+      }
+      if (Object.keys(fields).length > 0) reverse[specId] = fields;
+    }
+  }
+  const rollbackItem = { productId: entry.productId };
+  if (Object.keys(reverse).length > 0) rollbackItem.fields = reverse;
+  if (entry.vasBefore) rollbackItem.vasSnapshot = entry.vasBefore;
+  return rollbackItem.fields || rollbackItem.vasSnapshot ? rollbackItem : null;
+}
+
+function getCommittedEntries(state) {
+  return (state && Array.isArray(state.completed) ? state.completed : []).filter(entry => entry && entry.status !== "preview_only");
+}
+
+function getRollbackCandidates(state) {
+  return [...getCommittedEntries(state), ...(state && Array.isArray(state.verifyFailed) ? state.verifyFailed : [])];
+}
+
+function buildRollbackExecutionPlan(state) {
+  const operations = [];
+  for (const entry of getRollbackCandidates(state)) {
+    const item = buildRollbackItem(entry);
+    if (item) operations.push({ entry, item });
+  }
+  return { operations, items: operations.map(operation => operation.item) };
+}
+
+function evaluateRollbackVerification({ currentValues = {}, expectedFields = {}, vasApplicable = false, vasResult = null }) {
+  const fieldApplicable = expectedChangeCount(expectedFields) > 0;
+  const { matched, mismatched, checks } = fieldApplicable ? compareValues(currentValues, expectedFields) : { matched: [], mismatched: [], checks: [] };
+  let infrastructureError = fieldApplicable && checks.length === 0;
+  let total = checks.length;
+  let matchedCount = matched.length;
+  const mismatches = [...mismatched];
+  if (fieldApplicable && checks.length === 0) {
+    total = 1;
+    mismatches.push({ scope: "fields", field: "(all)", expected: "rollback fields", actual: "no checks produced" });
+  }
+  if (vasApplicable) {
+    const counts = parseVerificationCounts(vasResult && vasResult.verifyResult);
+    if (!vasResult || vasResult.status !== "ok" || !counts || counts.total === 0) {
+      infrastructureError = true;
+      total++;
+      mismatches.push({ scope: "vas", field: "readback", expected: "strict nonzero VAS verification", actual: vasResult?.message || "invalid verifyResult" });
+    } else {
+      total += counts.total;
+      matchedCount += counts.matched;
+      const vasMismatches = (vasResult.verifyResult.mismatches || []).map(item => ({ scope: "vas", ...item }));
+      if (counts.mismatched > 0 && vasMismatches.length === 0) vasMismatches.push({ scope: "vas", field: "(summary)", expected: "0 mismatches", actual: String(counts.mismatched) });
+      mismatches.push(...vasMismatches);
+    }
+  }
+  if (!fieldApplicable && !vasApplicable) {
+    return { status: "error", matched: 0, total: 1, mismatches: [{ field: "(all)", expected: "rollback evidence", actual: "no applicable checks" }] };
+  }
+  return { status: infrastructureError ? "error" : (mismatches.length > 0 ? "mismatch" : "verified"), matched: matchedCount, total, mismatches, vasVerify: vasResult };
+}
+
 function batchHasFormSetup(spec) {
   return (spec.items || []).some(item => hasFormSetup(normalizeBatchItem(spec, item).setup));
 }
 
+function batchHasImageOps(spec) {
+  return (spec.items || []).some(item => hasImageOps(normalizeBatchItem(spec, item).images));
+}
+
 function requireFormSetupExecutionConfirmation(spec) {
   if (!batchHasFormSetup(spec)) return;
   if (spec.options && spec.options.confirmFormSetupWithoutPreview === true) return;
   die("Batch contains form-level setup (tenancySet/specAddItems). Preview is blocked for this structure; set options.confirmFormSetupWithoutPreview=true only after explicit user confirmation.");
 }
 
+function requireImageExecutionConfirmation(spec) {
+  if (!batchHasImageOps(spec)) return;
+  if (spec.options && spec.options.confirmImageWithoutPreview === true) return;
+  die("Batch contains image operations. Preview is blocked for image selection/order; set options.confirmImageWithoutPreview=true only after explicit user confirmation.");
+}
+
 function addSetupPreviewBlockedDiff(diff, warnings, productId, setup) {
   const setupSummary = {
     tenancySet: setup.tenancySet || null,
@@ -248,6 +793,82 @@ function addSetupPreviewBlockedDiff(diff, warnings, productId, setup) {
   warnings.push({ productId, setup: setupSummary, ...entry });
 }
 
+function getVASPlanServiceIds(plan) {
+  if (!plan || !plan.services) return [];
+  const services = plan.services.set || plan.services.upsert || [];
+  return [...new Set(services.map(service => String(service.id)).filter(Boolean))];
+}
+
+function addVASValidationDiff(diff, warnings, productId, validation) {
+  for (const message of validation.errors || []) {
+    const entry = {
+      specId: "(vas)", field: "validation", old: "(current VAS state)", new: "(invalid plan)",
+      change: "VAS", pct: "N/A", status: "error", scope: "vas",
+      issues: [{ level: "error", message }],
+    };
+    diff.push(entry);
+    warnings.push({ productId, ...entry });
+  }
+  for (const message of validation.warnings || []) {
+    const entry = {
+      specId: "(vas)", field: "validation", old: "(current VAS state)", new: "(warning)",
+      change: "VAS", pct: "N/A", status: "warn", scope: "vas",
+      issues: [{ level: "warn", message }],
+    };
+    diff.push(entry);
+    warnings.push({ productId, ...entry });
+  }
+}
+
+async function previewVAS(productId, plan, diff, warnings, allowCurrentPage = false) {
+  if (!hasVASOps(plan)) return null;
+  const readCmd = allowCurrentPage
+    ? { action: "vas-read", allowCurrentPage: true, expectedProductId: productId }
+    : { action: "vas-read", productId };
+  const beforeR = await send(readCmd);
+  if (!beforeR || beforeR.status !== "ok") {
+    const entry = { specId: "(vas)", field: "read", old: "(unavailable)", new: "(unavailable)", change: "VAS", pct: "N/A", status: "error", scope: "vas", issues: [{ level: "error", message: beforeR?.message || "vas-read failed" }] };
+    diff.push(entry); warnings.push({ productId, ...entry });
+    return { beforeResult: beforeR };
+  }
+  const before = { enabled: beforeR.enabled, platforms: beforeR.platforms, services: beforeR.services };
+  const catalogR = await send({ action: "vas-catalog-read", allowCurrentPage: true, expectedProductId: productId, ids: getVASPlanServiceIds(plan) });
+  if (!catalogR || catalogR.status !== "ok") {
+    const entry = { specId: "(vas)", field: "catalog", old: "(unavailable)", new: "(unavailable)", change: "VAS", pct: "N/A", status: "error", scope: "vas", issues: [{ level: "error", message: catalogR?.message || "vas-catalog-read failed" }] };
+    diff.push(entry); warnings.push({ productId, ...entry });
+    return { before, catalogResult: catalogR };
+  }
+  const validation = validateVASPlan(plan, before, catalogR.catalog || []);
+  const target = buildTargetVASState(before, plan, catalogR.catalog || []);
+  diff.push(...buildVASDiff(before, target));
+  addVASValidationDiff(diff, warnings, productId, validation);
+  return { before, expected: target, catalog: catalogR.catalog || [], validation };
+}
+
+function addImagePreviewBlockedDiff(diff, warnings, productId, images) {
+  const imageSummary = {
+    pick: images.pick || null,
+    upload: images.upload || null,
+    orderedUrls: images.orderedUrls || null,
+    thumbnailFileName: images.thumbnailFileName || null,
+    whiteImage: images.whiteImage || null,
+    delayedVerifyImages: images.delayedVerify || null,
+  };
+  const message = "Batch preview with image operations is blocked because material selection and URL writeback can only be verified on the live form page; use execute only after explicit confirmation";
+  const entry = {
+    specId: "(images)",
+    field: "(image-ops)",
+    old: "(current page image state)",
+    new: JSON.stringify(imageSummary),
+    change: "N/A",
+    pct: "N/A",
+    status: "error",
+    issues: [{ level: "error", message }],
+  };
+  diff.push(entry);
+  warnings.push({ productId, images: imageSummary, ...entry });
+}
+
 // ================================================================
 // Daemon communication
 // ================================================================
@@ -274,12 +895,19 @@ function send(cmd) {
 // Single product pipeline
 // ================================================================
 
-async function processProduct(productId, changes, shared) {
-  const result = { productId, steps: [], status: "ok" };
+async function processProduct(productId, changes, shared, images = {}, vas = {}, options = {}, vasSnapshot = null, hooks = {}) {
+  const result = { productId, steps: [], status: "ok", expectedChanges: changes };
   let formValues = null; // values from current page state (after spec/tenancy changes)
   let onFormPage = false; // once true, do not navigate again before submit or unsaved setup changes are lost
+  let submitDispatched = false;
 
   try {
+    if (images && images.invalid) {
+      result.status = "failed";
+      result.error = images.invalid;
+      result.steps.push({ step: "image-plan-validate", status: "error", message: images.invalid });
+      return result;
+    }
     // Shared setup: tenancy (returns new structure values)
     if (shared.tenancySet) {
       const r = await send({ action: "tenancy-set", productId, days: shared.tenancySet });
@@ -313,53 +941,280 @@ async function processProduct(productId, changes, shared) {
       if (!readR || readR.status !== "ok" || !readR.values) return failBeforeApply(result, "read", readR);
       result.currentValues = readR.values;
     }
-    // Apply. If form-level structure changed, stay on current page to avoid losing unsaved changes.
-    ensureDir(BATCH_DIR);
-    const f = BATCH_DIR + "/changes_" + productId + ".json";
-    fs.writeFileSync(f, JSON.stringify(changes), "utf-8");
-    const applyAction = formValues ? "apply-current" : "apply";
-    const applyR = formValues
-      ? await send({ action: "apply-current", changesFile: f, allowCurrentPage: true, expectedProductId: productId })
-      : await send({ action: "apply", productId, changesFile: f });
-    result.steps.push({ step: applyAction, ...applyR });
-    if (!applyR || applyR.status !== "ok") {
-      result.status = "failed";
-      result.error = "Apply failed before submit";
-      result.applyResult = applyR;
-      result.steps.push({ step: "abort", reason: "apply_not_ok", applyStatus: applyR && applyR.status });
+
+    if (hasImageOps(images)) {
+      const imageReadCmd = onFormPage
+        ? { action: "image-read", allowCurrentPage: true, expectedProductId: productId }
+        : { action: "image-read", productId };
+      const imageReadR = await send(imageReadCmd);
+      result.steps.push({ step: "image-read", ...(imageReadR || {}) });
+      if (!imageReadR || imageReadR.status !== "ok") return failBeforeApply(result, "image-read", imageReadR);
+      result.imageBefore = { thumbs: imageReadR.thumbs, white: imageReadR.white, thumbnail: imageReadR.thumbnail };
+      onFormPage = true;
+
+      if (images.upload) {
+        const uploadR = await send({
+          action: "image-upload",
+          sectionType: images.upload.sectionType || "thumbs",
+          categoryName: images.upload.categoryName,
+          uploadFile: images.upload.uploadFile,
+          confirmSelection: images.upload.confirmSelection !== false,
+          allowDuplicateFileName: images.upload.allowDuplicateFileName === true,
+          allowCurrentPage: true,
+          expectedProductId: productId,
+        });
+        result.steps.push({ step: "image-upload", ...(uploadR || {}) });
+        if (!uploadR || uploadR.status !== "ok") return failBeforeApply(result, "image-upload", uploadR);
+        result.imageUploadResult = uploadR;
+      }
+
+      if (images.pick) {
+        const pickR = await send({
+          action: "image-pick",
+          categoryName: images.pick.categoryName,
+          fileNames: images.pick.fileNames,
+          skipIfAlreadyPresent: images.pick.skipIfAlreadyPresent === true,
+          allowCurrentPage: true,
+          expectedProductId: productId,
+        });
+        result.steps.push({ step: "image-pick", ...(pickR || {}) });
+        if (!pickR || pickR.status !== "ok") return failBeforeApply(result, "image-pick", pickR);
+        result.imagePickResult = pickR;
+      }
+
+      if (images.thumbnailFileName) {
+        const stateR = await send({ action: "image-read", allowCurrentPage: true, expectedProductId: productId });
+        result.steps.push({ step: "image-read-after-pick", ...(stateR || {}) });
+        if (!stateR || stateR.status !== "ok") return failBeforeApply(result, "image-read-after-pick", stateR);
+        const pickedSet = [];
+        if (result.imagePickResult && Array.isArray(result.imagePickResult.selected)) pickedSet.push(...result.imagePickResult.selected);
+        if (result.imageUploadResult && result.imageUploadResult.uploaded) pickedSet.push(result.imageUploadResult.uploaded);
+        const pickedTarget = pickedSet.find(item => item && item.name === images.thumbnailFileName);
+        if (!pickedTarget) {
+          result.status = "failed";
+          result.error = "Thumbnail target file not found in current upload/pick set: " + images.thumbnailFileName;
+          result.steps.push({ step: "image-order-prepare", status: "error", message: result.error });
+          return result;
+        }
+        const targetUrl = String(pickedTarget.imgUrl || "").startsWith("http")
+          ? String(pickedTarget.imgUrl)
+          : "https://zloss.xinyongzu.cn/" + String(pickedTarget.imgUrl || "").replace(/^\//, "");
+        images.orderedUrls = [targetUrl].concat((stateR.thumbs.values || []).filter(url => url !== targetUrl));
+      }
+
+      if (images.orderedUrls && images.orderedUrls.length > 0) {
+        const orderR = await send({
+          action: "image-order",
+          orderedUrls: images.orderedUrls,
+          allowCurrentPage: true,
+          expectedProductId: productId,
+        });
+        result.steps.push({ step: "image-order", ...(orderR || {}) });
+        if (!orderR || orderR.status !== "ok") return failBeforeApply(result, "image-order", orderR);
+        result.imageOrderResult = orderR;
+      }
+
+      if (images.whiteImage) {
+        const whiteR = await send({
+          action: "white-image-set",
+          categoryName: images.whiteImage.categoryName,
+          fileName: images.whiteImage.fileName,
+          skipIfWhiteImageMatched: images.whiteImage.skipIfWhiteImageMatched === true,
+          allowCurrentPage: true,
+          expectedProductId: productId,
+        });
+        result.steps.push({ step: "white-image-set", ...(whiteR || {}) });
+        if (!whiteR || whiteR.status !== "ok") return failBeforeApply(result, "white-image-set", whiteR);
+        result.whiteImageResult = whiteR;
+      }
+
+      const imageAfterR = await send({ action: "image-read", allowCurrentPage: true, expectedProductId: productId });
+      result.steps.push({ step: "image-read-final", ...(imageAfterR || {}) });
+      if (!imageAfterR || imageAfterR.status !== "ok") return failBeforeApply(result, "image-read-final", imageAfterR);
+      result.imageAfter = { thumbs: imageAfterR.thumbs, white: imageAfterR.white, thumbnail: imageAfterR.thumbnail };
+    }
+
+    if (hasVASOps(vas) || vasSnapshot) {
+      const vasReadR = await send(onFormPage
+        ? { action: "vas-read", allowCurrentPage: true, expectedProductId: productId }
+        : { action: "vas-read", productId });
+      result.steps.push({ step: "vas-read", ...(vasReadR || {}) });
+      if (!vasReadR || vasReadR.status !== "ok") return failBeforeApply(result, "vas-read", vasReadR);
+      result.vasBefore = { enabled: vasReadR.enabled, platforms: vasReadR.platforms, services: vasReadR.services };
+      onFormPage = true;
+
+      if (vasSnapshot) {
+        const validation = validateVASTargetState(vasSnapshot);
+        result.vasValidation = validation;
+        result.vasExpected = validation.target;
+        if (!validation.ok) {
+          result.status = "failed";
+          result.error = "VAS snapshot validation failed: " + validation.errors.join("; ");
+          result.steps.push({ step: "vas-snapshot-validate", status: "error", errors: validation.errors, warnings: validation.warnings });
+          return result;
+        }
+        result.steps.push({ step: "vas-snapshot-validate", status: "ok", warnings: validation.warnings });
+      } else {
+        const vasCatalogR = await send({ action: "vas-catalog-read", allowCurrentPage: true, expectedProductId: productId, ids: getVASPlanServiceIds(vas) });
+        result.steps.push({ step: "vas-catalog-read", ...(vasCatalogR || {}) });
+        if (!vasCatalogR || vasCatalogR.status !== "ok") return failBeforeApply(result, "vas-catalog-read", vasCatalogR);
+        const validation = validateVASPlan(vas, result.vasBefore, vasCatalogR.catalog || []);
+        result.vasExpected = buildTargetVASState(result.vasBefore, vas, vasCatalogR.catalog || []);
+        result.vasValidation = validation;
+        if (!validation.ok) {
+          result.status = "failed";
+          result.error = "VAS validation failed: " + validation.errors.join("; ");
+          result.steps.push({ step: "vas-validate", status: "error", errors: validation.errors, warnings: validation.warnings });
+          return result;
+        }
+        result.steps.push({ step: "vas-validate", status: "ok", warnings: validation.warnings });
+      }
+      const vasApplyR = await send({ action: "vas-apply", allowCurrentPage: true, expectedProductId: productId, expectedVAS: result.vasExpected });
+      result.steps.push({ step: "vas-apply", ...(vasApplyR || {}) });
+      result.vasApplyResult = vasApplyR;
+      if (!vasApplyR || vasApplyR.status !== "ok") return failBeforeApply(result, "vas-apply", vasApplyR);
+      onFormPage = true;
+    }
+
+    const hasFieldChanges = Boolean(changes && Object.keys(changes).length > 0);
+    if (hasFieldChanges) {
+      // Apply. If form-level structure changed, stay on current page to avoid losing unsaved changes.
+      ensureDir(BATCH_DIR);
+      const f = BATCH_DIR + "/changes_" + productId + ".json";
+      fs.writeFileSync(f, JSON.stringify(changes), "utf-8");
+      const applyAction = onFormPage ? "apply-current" : "apply";
+      const applyR = onFormPage
+        ? await send({ action: "apply-current", changesFile: f, allowCurrentPage: true, expectedProductId: productId })
+        : await send({ action: "apply", productId, changesFile: f });
+      result.steps.push({ step: applyAction, ...applyR });
+      if (!applyR || applyR.status !== "ok") {
+        result.status = "failed";
+        result.error = "Apply failed before submit";
+        result.applyResult = applyR;
+        result.steps.push({ step: "abort", reason: "apply_not_ok", applyStatus: applyR && applyR.status });
+        return result;
+      }
+    } else {
+      result.steps.push({ step: "apply-skip", reason: "no_field_changes" });
+    }
+
+    if (options.skipSubmit === true) {
+      result.status = "preview_only";
+      result.steps.push({ step: "submit-skip", reason: "skipSubmit=true" });
+      const changedCurrentForm = onFormPage || hasFieldChanges;
+      if (changedCurrentForm) {
+        result.previewState = {
+          currentValues: result.currentValues || null,
+          imageBefore: result.imageBefore || null,
+          imageAfter: result.imageAfter || null,
+          vasBefore: result.vasBefore || null,
+          vasExpected: result.vasExpected || null,
+        };
+        const discardR = await send({ action: "discard-current-form", expectedProductId: productId });
+        result.discardResult = discardR;
+        result.steps.push({ step: "discard-current-form", ...(discardR || {}) });
+        if (!discardR || discardR.status !== "ok") {
+          result.status = "failed";
+          result.error = "Failed to discard current form after skipSubmit";
+        }
+      }
       return result;
     }
+
     // Submit
-    const submitR = await send({ action: "submit" });
+    if (typeof hooks.onSubmitting === "function") hooks.onSubmitting(buildSubmittingCheckpoint(result));
+    let submitR;
+    try {
+      const rawSubmitResult = await send(buildSubmitCommand(productId));
+      submitDispatched = true;
+      submitR = normalizeSubmitCommandResult(rawSubmitResult);
+    } catch (err) {
+      return buildSubmitTransportRecovery(result, err);
+    }
     result.steps.push({ step: "submit", ...submitR });
+    result.submitResult = submitR;
+    if (typeof hooks.onSubmitted === "function") hooks.onSubmitted(buildSubmittedCheckpoint(result));
     if (submitR.status === "error") {
       result.status = "failed";
       result.error = "Submit failed";
-      result.submitResult = submitR;
-      return result;
-    }
-    if (submitR.status === "unknown") {
-      result.warnings = result.warnings || [];
-      result.warnings.push("Submit result unknown; readback verification required");
-    }
-    // Verify: read and compare with expected values
-    const verifyR = await send({ action: "read", productId });
-    if (!verifyR || verifyR.status === "error" || !verifyR.values) {
-      result.status = "verify_failed";
-      result.verifyResult = buildReadbackFailure(verifyR);
-      result.steps.push({ step: "verify", status: "error", ...result.verifyResult });
       return result;
     }
-    const { matched, mismatched } = compareValues(verifyR.values, changes);
-    result.finalValues = verifyR.values;
-    result.verifyResult = { total: matched.length + mismatched.length, matched: matched.length, mismatched: mismatched.length, mismatches: mismatched };
-    if (mismatched.length > 0) {
-      result.status = "verify_failed";
-      result.steps.push({ step: "verify", status: "mismatch", ...result.verifyResult });
+    const verificationEvidence = [];
+
+    if (!hasFieldChanges) {
+      result.steps.push({ step: "verify-skip", reason: "no_field_changes" });
     } else {
-      result.steps.push({ step: "verify", status: "ok", matched: matched.length });
+      // Verify: read and compare with expected values
+      const verifyR = await send({ action: "read", productId });
+      if (!verifyR || verifyR.status === "error" || !verifyR.values) {
+        result.status = "verify_failed";
+        result.verifyResult = buildReadbackFailure(verifyR);
+        verificationEvidence.push({ scope: "fields", applicable: true, status: "failed" });
+        if (submitR.status === "unknown") result.submitResolution = resolveSubmitByReadback(submitR, verificationEvidence);
+        result.steps.push({ step: "verify", status: "error", ...result.verifyResult });
+        return result;
+      }
+      const fieldEvaluation = evaluateImmediateFieldVerification(verifyR.values, changes);
+      result.finalValues = verifyR.values;
+      result.verifyResult = fieldEvaluation.verifyResult;
+      if (fieldEvaluation.status === "failed") {
+        result.status = "verify_failed";
+        verificationEvidence.push({ scope: "fields", applicable: true, status: "failed" });
+        result.steps.push({ step: "verify", status: "mismatch", ...result.verifyResult });
+      } else {
+        verificationEvidence.push({ scope: "fields", applicable: true, status: "ok" });
+        result.steps.push({ step: "verify", status: "ok", matched: result.verifyResult.matched });
+      }
+    }
+
+    if ((hasVASOps(vas) || vasSnapshot) && result.vasExpected) {
+      const vasVerifyR = await send({ action: "vas-verify", productId, expectedVAS: result.vasExpected });
+      result.steps.push({ step: "vas-verify", ...(vasVerifyR || {}) });
+      result.vasVerifyResult = vasVerifyR;
+      const vasEvaluation = evaluateImmediateScopedVerification(vasVerifyR);
+      if (vasEvaluation.status === "failed") {
+        result.status = "verify_failed";
+        verificationEvidence.push({ scope: "vas", applicable: true, status: "failed" });
+        if (submitR.status === "unknown") result.submitResolution = resolveSubmitByReadback(submitR, verificationEvidence);
+        return result;
+      }
+      verificationEvidence.push({ scope: "vas", applicable: true, status: "ok" });
+    }
+
+    if (hasImageOps(images)) {
+      const expectedImages = {};
+      const finalImageState = result.imageAfter || null;
+      if (finalImageState && finalImageState.thumbs && Array.isArray(finalImageState.thumbs.values) && finalImageState.thumbs.values.length > 0) {
+        expectedImages.thumbs = finalImageState.thumbs.values;
+        expectedImages.thumbnail = finalImageState.thumbnail || finalImageState.thumbs.values[0] || "";
+      }
+      if (finalImageState && finalImageState.white && finalImageState.white.value) {
+        expectedImages.white = finalImageState.white.value;
+      }
+      const imageVerifyR = await send({ action: "image-verify", productId, expectedImages });
+      result.steps.push({ step: "image-verify", ...(imageVerifyR || {}) });
+      result.imageVerifyResult = imageVerifyR;
+      const imageEvaluation = evaluateImmediateScopedVerification(imageVerifyR);
+      if (imageEvaluation.status === "failed") {
+        result.status = "verify_failed";
+        verificationEvidence.push({ scope: "images", applicable: true, status: "failed" });
+        if (submitR.status === "unknown") result.submitResolution = resolveSubmitByReadback(submitR, verificationEvidence);
+        return result;
+      }
+      verificationEvidence.push({ scope: "images", applicable: true, status: "ok" });
+    }
+
+    if (submitR.status === "unknown") {
+      const resolution = resolveSubmitByReadback(submitR, verificationEvidence);
+      result.submitResolution = resolution;
+      if (resolution.status === "ok") {
+        result.steps.push({ step: "submit-resolution", ...resolution });
+      } else {
+        result.status = "verify_failed";
+      }
     }
   } catch (err) {
+    if (submitDispatched) return buildPostSubmitVerificationRecovery(result, err);
     result.status = "failed"; result.error = err.message;
     result.steps.push({ step: "error", message: err.message });
   }
@@ -371,10 +1226,14 @@ async function processProduct(productId, changes, shared) {
 // ================================================================
 
 async function batchPreview(spec) {
-  await send({ action: "login" });
-
   const cfg = loadConfig();
   const rules = cfg.rules || {};
+  const itemCheck = validateBatchItems(spec);
+  if (!itemCheck.ok) die(itemCheck.message);
+  const batchSizeCheck = validateBatchSize(spec, rules);
+  if (!batchSizeCheck.ok) die(batchSizeCheck.message);
+
+  await send({ action: "login" });
   const items = spec.items || [];
   const previews = [];
   const warnings = [];
@@ -384,16 +1243,38 @@ async function batchPreview(spec) {
     const pid = normalized.productId;
     log("Previewing " + pid + "...");
     const diff = [];
-    if (hasFormSetup(normalized.setup)) {
-      addSetupPreviewBlockedDiff(diff, warnings, pid, normalized.setup);
-      previews.push({ productId: pid, setup: normalized.setup, specs: [], diff });
+    const setupBlocked = hasFormSetup(normalized.setup);
+    const imageBlocked = hasImageOps(normalized.images);
+    if (setupBlocked) addSetupPreviewBlockedDiff(diff, warnings, pid, normalized.setup);
+    if (imageBlocked) addImagePreviewBlockedDiff(diff, warnings, pid, normalized.images);
+
+    let vasPreview = null;
+    if (normalized.vasSnapshot) {
+      const beforeR = await send({ action: "vas-read", productId: pid });
+      if (!beforeR || beforeR.status !== "ok") {
+        const entry = { specId: "(vas)", field: "read", old: "(unavailable)", new: "(snapshot)", change: "VAS", pct: "N/A", status: "error", scope: "vas", issues: [{ level: "error", message: beforeR?.message || "vas-read failed" }] };
+        diff.push(entry); warnings.push({ productId: pid, ...entry });
+        vasPreview = { beforeResult: beforeR };
+      } else {
+        const before = { enabled: beforeR.enabled, platforms: beforeR.platforms, services: beforeR.services };
+        const validation = validateVASTargetState(normalized.vasSnapshot);
+        diff.push(...buildVASDiff(before, validation.target));
+        addVASValidationDiff(diff, warnings, pid, validation);
+        vasPreview = { before, expected: validation.target, validation, snapshot: true };
+      }
+    } else if (hasVASOps(normalized.vas)) {
+      vasPreview = await previewVAS(pid, normalized.vas, diff, warnings, false);
+    }
+
+    if (setupBlocked || imageBlocked) {
+      previews.push({ productId: pid, setup: normalized.setup, images: normalized.images, vas: normalized.vas, vasPreview, specs: [], diff });
       continue;
     }
     const readR = await send({ action: "read", productId: pid });
     const itemFields = normalized.changes;
     if (!readR || readR.status === "error" || !readR.values) {
       addReadErrorDiff(diff, warnings, pid, readR);
-      previews.push({ productId: pid, specs: readR && readR.specs ? readR.specs : [], diff });
+      previews.push({ productId: pid, vas: normalized.vas, vasPreview, specs: readR && readR.specs ? readR.specs : [], diff });
       continue;
     }
 
@@ -416,7 +1297,7 @@ async function batchPreview(spec) {
         }
       }
     }
-    previews.push({ productId: pid, specs: readR.specs, diff });
+    previews.push({ productId: pid, vas: normalized.vas, vasPreview, specs: readR.specs, diff });
   }
 
   return { previews, warnings, hasErrors: warnings.some(w => w.status === "error"), hasWarnings: warnings.some(w => w.status === "warn") };
@@ -427,43 +1308,67 @@ async function batchPreview(spec) {
 // ================================================================
 
 async function batchExecute(spec) {
+  const cfg = loadConfig();
+  const itemCheck = validateBatchItems(spec);
+  if (!itemCheck.ok) die(itemCheck.message);
+  const batchSizeCheck = validateBatchSize(spec, cfg.rules || {});
+  if (!batchSizeCheck.ok) die(batchSizeCheck.message);
   requireFormSetupExecutionConfirmation(spec);
+  requireImageExecutionConfirmation(spec);
   ensureDir(BATCH_DIR);
   await send({ action: "login" });
   const items = spec.items || [];
   const batchId = "batch_" + Date.now();
   const stateFile = BATCH_DIR + "/" + batchId + "_state.json";
 
-  const state = { batchId, spec, total: items.length, completed: [], verifyFailed: [], failed: [], current: null, status: "running", startedAt: new Date().toISOString() };
+  const state = { batchId, spec, total: items.length, completed: [], previewOnly: [], verifyFailed: [], failed: [], current: null, inFlight: null, status: "running", startedAt: new Date().toISOString() };
   if (spec.resumeFrom) state.resumeFrom = spec.resumeFrom;
   if (spec.resumedAt) state.resumedAt = spec.resumedAt;
-  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
+  writeJsonAtomic(stateFile, state);
   log("Batch " + batchId + ": " + items.length + " items");
 
   let stopped = false;
   for (const item of items) {
     const pid = item.productId;
-    state.current = pid; fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
+    state.current = pid; writeJsonAtomic(stateFile, state);
     log("[" + (state.completed.length + 1) + "/" + state.total + "] " + pid);
     const normalized = normalizeBatchItem(spec, item);
-    const result = await processProduct(pid, normalized.changes, normalized.setup);
-    if (result.status === "ok") { state.completed.push(result); log("  OK"); }
+    const result = await processProduct(pid, normalized.changes, normalized.setup, normalized.images, normalized.vas, spec.options || {}, normalized.vasSnapshot, {
+      onSubmitting(checkpoint) {
+        state.inFlight = checkpoint;
+        writeJsonAtomic(stateFile, state);
+      },
+      onSubmitted(checkpoint) {
+        state.inFlight = checkpoint;
+        writeJsonAtomic(stateFile, state);
+      },
+    });
+    let stopAfterPersist = false;
+    if (result.status === "ok") {
+      state.completed.push(result);
+      log("  OK");
+    }
+    else if (result.status === "preview_only") {
+      state.previewOnly.push(result);
+      log("  OK (skip submit; not committed)");
+    }
     else if (result.status === "verify_failed") { state.verifyFailed.push(result); log("  WARN: verify mismatch"); }
     else {
       state.failed.push(result);
-      log("  FAIL: " + result.error);
-      if (spec.options && spec.options.stopOnError) { stopped = true; state.status = "stopped"; break; }
+      log("  FAIL: " + (result.error || result.status));
+      if (spec.options && spec.options.stopOnError) { stopped = true; state.status = "stopped"; stopAfterPersist = true; }
     }
+    state.inFlight = null;
+    state.current = null;
+    writeJsonAtomic(stateFile, state);
+    if (stopAfterPersist) break;
   }
   state.current = null;
-  if (stopped) state.status = "stopped";
-  else if (state.failed.length > 0) state.status = "partial";
-  else if (state.verifyFailed.length > 0) state.status = "completed_with_mismatch";
-  else state.status = "completed";
+  state.status = deriveBatchFinalStatus(state, stopped);
   state.finishedAt = new Date().toISOString();
-  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
+  writeJsonAtomic(stateFile, state);
 
-  const report = { batchId, total: state.total, success: state.completed.length, verifyFailed: state.verifyFailed.length, failed: state.failed.length, status: state.status, items: state.completed.concat(state.verifyFailed || [], state.failed) };
+  const report = { batchId, total: state.total, success: state.completed.length, previewOnly: state.previewOnly.length, verifyFailed: state.verifyFailed.length, failed: state.failed.length, status: state.status, items: state.completed.concat(state.previewOnly || [], state.verifyFailed || [], state.failed) };
   output(report);
   return { report, stateFile, state };
 }
@@ -474,20 +1379,33 @@ async function batchExecute(spec) {
 
 async function batchResume() {
   ensureDir(BATCH_DIR);
-  const files = fs.readdirSync(BATCH_DIR).filter(f => f.endsWith("_state.json")).sort((a, b) => fs.statSync(BATCH_DIR + "/" + b).mtimeMs - fs.statSync(BATCH_DIR + "/" + a).mtimeMs);
-  if (files.length === 0) die("No batch to resume");
-  const statePath = BATCH_DIR + "/" + files[0];
-  const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
-  if (state.status === "completed" || state.status === "completed_with_mismatch" || state.status === "delayed_verified") die("Last batch completed");
-  const doneIds = new Set((state.completed || []).concat(state.verifyFailed || [], state.failed || []).map(x => x.productId));
-  const remaining = state.spec.items.filter(item => !doneIds.has(item.productId));
+  const candidates = fs.readdirSync(BATCH_DIR).filter(file => file.endsWith("_state.json")).map(file => {
+    const statePath = BATCH_DIR + "/" + file;
+    try { return { path: statePath, mtimeMs: fs.statSync(statePath).mtimeMs, state: JSON.parse(fs.readFileSync(statePath, "utf-8")) }; }
+    catch { return { path: statePath, mtimeMs: 0, state: null }; }
+  });
+  const selected = selectLatestResumableBatchState(candidates);
+  if (!selected) die("No resumable batch found");
+  const statePath = selected.path;
+  const loadedState = selected.state;
+  const prepared = prepareResumeState(loadedState);
+  const state = prepared.state;
+  const remaining = prepared.remainingItems;
+  writeJsonAtomic(statePath, state);
   log("Resuming: " + remaining.length + " remaining of " + state.total);
   const resumedAt = new Date().toISOString();
+  if (remaining.length === 0) {
+    state.resumedAt = resumedAt;
+    state.status = state.verifyFailed.some(entry => entry.automaticResubmitBlocked === true) ? "recovery_required" : state.status;
+    writeJsonAtomic(statePath, state);
+    return { statePath, state };
+  }
   const resumed = await batchExecute({ items: remaining, shared: state.spec.shared || state.spec.sharedSetup, sharedSetup: state.spec.sharedSetup, options: state.spec.options, resumeFrom: state.batchId, resumedAt });
   state.resumedAt = resumedAt;
   state.resumedTo = resumed.state.batchId;
   state.resumeStateFile = path.basename(resumed.stateFile);
-  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
+  state.status = "resumed";
+  writeJsonAtomic(statePath, state);
 }
 
 // ================================================================
@@ -497,8 +1415,8 @@ async function batchResume() {
 async function batchDelayedVerify(statePath) {
   if (!fs.existsSync(statePath)) die("State file not found: " + statePath);
   const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
-  const completed = state.completed || [];
-  if (completed.length === 0) die("No completed products to verify");
+  const completed = getCommittedEntries(state);
+  if (completed.length === 0) die("No committed products to verify");
 
   await send({ action: "login" });
   log("Delayed verify: " + completed.length + " products");
@@ -507,7 +1425,8 @@ async function batchDelayedVerify(statePath) {
   const changesMap = {};
   if (state.spec && state.spec.items) {
     for (const item of state.spec.items) {
-      changesMap[item.productId] = item.fields || item.changes || {};
+      const normalized = normalizeBatchItem(state.spec, item);
+      changesMap[item.productId] = { changes: normalized.changes, setup: normalized.setup, images: normalized.images, vas: normalized.vas };
     }
   }
 
@@ -516,15 +1435,46 @@ async function batchDelayedVerify(statePath) {
     log("Verifying " + pid + "...");
 
     try {
+      const expectedPack = changesMap[pid] || { changes: {}, setup: {}, images: {}, vas: {} };
+      const expected = expectedPack.changes || {};
+      const reference = entry.imageVerifyResult?.readback || entry.imageAfter || null;
+      const imageApplicable = hasImageOps(expectedPack.images || {}) || Boolean(reference);
+      const vasApplicable = Boolean(entry.vasExpected);
+      const setupApplicable = hasFormSetup(expectedPack.setup || {});
       const readR = await send({ action: "read", productId: String(pid) });
-      const current = readR.values || {};
-      const expected = changesMap[pid] || {};
-      const { checks } = compareValues(current, expected);
-
-      const passed = checks.filter(c => c.match).length;
-      const failed = checks.filter(c => !c.match).length;
-      results.push({ productId: pid, status: failed === 0 ? "verified" : "mismatch", total: checks.length, passed, failed, checks });
-      log("  " + (failed === 0 ? "鉁? : "鉁?) + " " + passed + "/" + checks.length + " matched");
+
+      let imageResult = null;
+      if (readR && readR.status !== "error" && readR.values && imageApplicable) {
+        const expectedImages = {};
+        if (reference && reference.thumbs && Array.isArray(reference.thumbs.values) && reference.thumbs.values.length > 0) {
+          expectedImages.thumbs = reference.thumbs.values;
+          expectedImages.thumbnail = reference.thumbnail || reference.thumbs.values[0] || "";
+        }
+        if (reference && reference.white && reference.white.value) {
+          expectedImages.white = reference.white.value;
+        }
+        imageResult = await send({ action: "image-verify", productId: String(pid), expectedImages });
+      }
+
+      let vasResult = null;
+      if (readR && readR.status !== "error" && readR.values && vasApplicable) {
+        vasResult = await send({ action: "vas-verify", productId: String(pid), expectedVAS: entry.vasExpected });
+      }
+
+      const evaluation = evaluateDelayedVerification({
+        readResult: readR,
+        expectedChanges: expected,
+        imageApplicable,
+        imageResult,
+        vasApplicable,
+        vasResult,
+        requireAnyCheck: setupApplicable,
+      });
+      results.push({
+        productId: pid,
+        ...evaluation,
+      });
+      log("  " + (evaluation.status === "verified" ? "鉁? : "鉁?) + " fields=" + evaluation.fieldPassed + "/" + evaluation.checks.length + (imageApplicable ? (", images=" + evaluation.imagePassed + "/" + evaluation.imageTotal) : "") + (vasApplicable ? (", vas=" + evaluation.vasPassed + "/" + evaluation.vasTotal) : ""));
     } catch (err) {
       results.push({ productId: pid, status: "error", error: err.message });
       log("  鉁?ERROR: " + err.message);
@@ -532,11 +1482,12 @@ async function batchDelayedVerify(statePath) {
   }
 
   // Update state
-  state.delayedVerify = { at: new Date().toISOString(), results };
-  state.status = results.every(r => r.status === "verified") ? "delayed_verified" : "delayed_verify_partial";
-  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
+  const unresolvedCount = countDelayedUnresolved(state);
+  state.delayedVerify = { at: new Date().toISOString(), results, unresolvedCount };
+  state.status = deriveDelayedStateStatus(results, unresolvedCount);
+  writeJsonAtomic(statePath, state);
 
-  const summary = { total: results.length, verified: results.filter(r => r.status === "verified").length, mismatch: results.filter(r => r.status === "mismatch").length, error: results.filter(r => r.status === "error").length, results };
+  const summary = { total: results.length, verified: results.filter(r => r.status === "verified").length, mismatch: results.filter(r => r.status === "mismatch").length, error: results.filter(r => r.status === "error").length, unresolved: unresolvedCount, results };
   output(summary);
 }
 
@@ -547,7 +1498,8 @@ async function batchDelayedVerify(statePath) {
 async function batchReport(statePath) {
   if (!fs.existsSync(statePath)) die("State file not found: " + statePath);
   const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
-  const completed = state.completed || [];
+  const completed = getCommittedEntries(state);
+  const previewOnly = state.previewOnly || (state.completed || []).filter(entry => entry && entry.status === "preview_only");
   const verifyFailed = state.verifyFailed || [];
   const failed = state.failed || [];
 
@@ -556,11 +1508,13 @@ async function batchReport(statePath) {
   log("Started: " + state.startedAt);
   log("Finished: " + (state.finishedAt || "N/A"));
   log("Status: " + state.status);
-  log("Products: " + state.total + " total, " + completed.length + " done, " + verifyFailed.length + " verify_failed, " + failed.length + " failed");
+  log("Products: " + state.total + " total, " + completed.length + " committed, " + previewOnly.length + " preview_only, " + verifyFailed.length + " verify_failed, " + failed.length + " failed");
   log("");
 
   for (const entry of completed) {
     log("--- Product " + entry.productId + " ---");
+    for (const line of buildSubmitAuditLines(entry, "  ")) log(line);
+    for (const line of buildVerificationAuditLines(entry, "  ")) log(line);
     if (entry.currentValues) {
       for (const [specId, sv] of Object.entries(entry.currentValues)) {
         log("  " + specId + ": " + JSON.stringify(sv));
@@ -578,26 +1532,34 @@ async function batchReport(statePath) {
         }
       }
     }
-    if (entry.verifyResult) {
-      log("  Verify: " + entry.verifyResult.matched + "/" + entry.verifyResult.total + " matched");
-      if (entry.verifyResult.mismatched > 0) {
-        log("  Mismatches:");
-        for (const m of entry.verifyResult.mismatches) {
-          log("    " + m.specId + " " + m.field + ": expected " + m.expected + ", got " + m.actual);
-        }
-      }
+    if (entry.vasBefore || entry.vasExpected || entry.vasVerifyResult) {
+      const summarizeVAS = state => state ? ("enabled=" + state.enabled + ", platforms=[" + (state.platforms || []).join(",") + "], services=[" + (state.services || []).map(service => service.id).join(",") + "]") : "N/A";
+      log("  VAS before: " + summarizeVAS(entry.vasBefore));
+      log("  VAS expected: " + summarizeVAS(entry.vasExpected));
     }
     log("");
   }
 
+  if (previewOnly.length > 0) {
+    log("=== Preview Only (not committed) ===");
+    for (const entry of previewOnly) log("  " + entry.productId + ": skipSubmit=true, form changes discarded");
+  }
+
   if (verifyFailed.length > 0) {
     log("=== Verify Failed ===");
-    for (const f of verifyFailed) log("  " + f.productId + ": " + ((f.verifyResult && f.verifyResult.mismatched) || 0) + " mismatches");
+    for (const f of verifyFailed) {
+      log("  " + f.productId + ": " + ((f.verifyResult && f.verifyResult.mismatched) || 0) + " mismatches");
+      for (const line of buildSubmitAuditLines(f, "    ")) log(line);
+      for (const line of buildVerificationAuditLines(f, "    ")) log(line);
+    }
   }
 
   if (failed.length > 0) {
     log("=== Failed ===");
-    for (const f of failed) log("  " + f.productId + ": " + (f.error || "unknown"));
+    for (const f of failed) {
+      log("  " + f.productId + ": " + (f.error || "unknown"));
+      for (const line of buildSubmitAuditLines(f, "    ")) log(line);
+    }
   }
 
   if (state.delayedVerify) {
@@ -605,6 +1567,10 @@ async function batchReport(statePath) {
     log("=== Delayed Verify ===");
     log("At: " + dv.at);
     log("Results: " + dv.results.filter(r => r.status === "verified").length + "/" + dv.results.length + " verified");
+    log("Unresolved entries: " + Number(dv.unresolvedCount || 0));
+    for (const result of dv.results || []) {
+      log("  " + result.productId + ": status=" + result.status + ", fieldFailed=" + Number(result.fieldFailed || 0) + ", imageFailed=" + Number(result.imageFailed || 0) + ", vasFailed=" + Number(result.vasFailed || 0));
+    }
   }
 }
 
@@ -615,27 +1581,8 @@ async function batchReport(statePath) {
 async function batchRollback(statePath) {
   if (!fs.existsSync(statePath)) die("State file not found: " + statePath);
   const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
-  const completed = state.completed || [];
-  if (completed.length === 0) die("No completed products to rollback");
-
-  // Build reverse spec from currentValues (before state)
-  const items = [];
-  for (const entry of completed) {
-    const reverse = {};
-    const priceFields = ["stock", "rent1day", "rent10day", "rent30day", "marketPrice", "deposit", "purchasePrice", "costPrice", "finalPayment"];
-    if (entry.currentValues) {
-      for (const [specId, sv] of Object.entries(entry.currentValues)) {
-        reverse[specId] = {};
-        for (const [field, val] of Object.entries(sv)) {
-          if (priceFields.includes(field)) reverse[specId][field] = val;
-        }
-      }
-    }
-    if (Object.keys(reverse).length > 0) {
-      items.push({ productId: entry.productId, fields: reverse });
-    }
-  }
-
+  const plan = buildRollbackExecutionPlan(state);
+  const items = plan.items;
   if (items.length === 0) die("No rollback data found in state");
 
   log("Rollback: " + items.length + " products to restore");
@@ -663,22 +1610,9 @@ async function batchRollback(statePath) {
 
 async function batchRollbackConfirm(statePath) {
   const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
-  const completed = state.completed || [];
-
-  const items = [];
-  for (const entry of completed) {
-    const reverse = {};
-    const priceFields = ["stock", "rent1day", "rent10day", "rent30day", "marketPrice", "deposit", "purchasePrice", "costPrice", "finalPayment"];
-    if (entry.currentValues) {
-      for (const [specId, sv] of Object.entries(entry.currentValues)) {
-        reverse[specId] = {};
-        for (const [field, val] of Object.entries(sv)) {
-          if (priceFields.includes(field)) reverse[specId][field] = val;
-        }
-      }
-    }
-    if (Object.keys(reverse).length > 0) items.push({ productId: entry.productId, fields: reverse });
-  }
+  const plan = buildRollbackExecutionPlan(state);
+  const items = plan.items;
+  if (items.length === 0) die("No rollback data found in state");
 
   log("Executing rollback for " + items.length + " products...");
   await batchExecute({ items, options: { stopOnError: false } });
@@ -686,7 +1620,8 @@ async function batchRollbackConfirm(statePath) {
   log("Verifying rollback...");
   await send({ action: "login" });
   const results = [];
-  for (const entry of completed) {
+  for (const operation of plan.operations) {
+    const entry = operation.entry;
     const pid = entry.productId;
     const readR = await send({ action: "read", productId: String(pid) });
     if (!readR || readR.status === "error" || !readR.values) {
@@ -696,20 +1631,14 @@ async function batchRollbackConfirm(statePath) {
       continue;
     }
     const current = readR.values || {};
-    const expected = entry.currentValues || {};
-    let matched = 0, total = 0;
-    const mismatches = [];
-    for (const [specId, exp] of Object.entries(expected)) {
-      const sv = current[specId] || {};
-      for (const [field, expVal] of Object.entries(exp)) {
-        total++;
-        if (sv[field] === expVal) matched++;
-        else mismatches.push({ specId, field, expected: expVal, actual: sv[field] || "(missing)" });
-      }
+    const expected = operation.item.fields || {};
+    let vasVerify = null;
+    if (entry.vasBefore) {
+      vasVerify = await send({ action: "vas-verify", productId: String(pid), expectedVAS: entry.vasBefore });
     }
-    const status = matched === total ? "verified" : "mismatch";
-    results.push({ productId: pid, status, matched, total, mismatches });
-    log("  " + pid + ": " + matched + "/" + total + " fields restored");
+    const evaluation = evaluateRollbackVerification({ currentValues: current, expectedFields: expected, vasApplicable: Boolean(entry.vasBefore), vasResult: vasVerify });
+    results.push({ productId: pid, ...evaluation });
+    log("  " + pid + ": " + evaluation.matched + "/" + evaluation.total + " fields/VAS checks restored (" + evaluation.status + ")");
   }
   const summary = { status: results.every(r => r.status === "verified") ? "ok" : "mismatch", results };
   output(summary);
@@ -745,11 +1674,60 @@ async function main() {
       const files = fs.readdirSync(BATCH_DIR).filter(f => f.endsWith("_state.json")).sort((a, b) => fs.statSync(BATCH_DIR + "/" + b).mtimeMs - fs.statSync(BATCH_DIR + "/" + a).mtimeMs);
       if (files.length === 0) { output({ status: "none" }); break; }
       const st = JSON.parse(fs.readFileSync(BATCH_DIR + "/" + files[0], "utf-8"));
-      output({ batchId: st.batchId, total: st.total, done: (st.completed || []).length, verifyFailed: (st.verifyFailed || []).length, failed: (st.failed || []).length, current: st.current, status: st.status });
+      output({ batchId: st.batchId, total: st.total, done: getCommittedEntries(st).length, previewOnly: (st.previewOnly || (st.completed || []).filter(entry => entry && entry.status === "preview_only")).length, verifyFailed: (st.verifyFailed || []).length, failed: (st.failed || []).length, current: st.current, status: st.status });
       break;
     }
     default: die("Unknown: " + args[0]);
   }
 }
 
-main().catch(err => die(err.message));
+if (require.main === module) {
+  main().catch(err => die(err.message));
+} else {
+  module.exports = {
+    normalizeImagePlan,
+    hasImageOps,
+    normalizeVASPlan,
+    hasVASOps,
+    validateVASPlan,
+    buildTargetVASState,
+    validateVASTargetState,
+    compareVASState,
+    buildVASDiff,
+    normalizeSetup,
+    mergeSetup,
+    hasFormSetup,
+    normalizeBatchItem,
+    buildRollbackItem,
+    buildRollbackExecutionPlan,
+    evaluateRollbackVerification,
+    getCommittedEntries,
+    getRollbackCandidates,
+    batchHasFormSetup,
+    batchHasImageOps,
+    validateBatchSize,
+    validateBatchItems,
+    compareValues,
+    resolveSubmitByReadback,
+    buildSubmitCommand,
+    normalizeSubmitCommandResult,
+    redactPreview,
+    buildSubmitTransportRecovery,
+    buildPostSubmitVerificationRecovery,
+    buildSubmitAuditSummary,
+    buildSubmitAuditLines,
+    buildVerificationAuditLines,
+    buildSubmittingCheckpoint,
+    buildSubmittedCheckpoint,
+    prepareResumeState,
+    evaluateImmediateFieldVerification,
+    evaluateImmediateScopedVerification,
+    evaluateDelayedVerification,
+    deriveDelayedStateStatus,
+    countDelayedUnresolved,
+    deriveBatchFinalStatus,
+    writeJsonAtomic,
+    isResumableBatchState,
+    selectLatestResumableBatchState,
+  };
+}
diff --git a/old/scripts/init.js b/new/scripts/init.js
index 5f9a24e..ee1c76b 100644
--- a/old/scripts/init.js
+++ b/new/scripts/init.js
@@ -110,7 +110,7 @@ async function checkMirror(cfg) {
   if (!cfg?.mirror?.baseUrl || !cfg?.mirror?.apiKey) { warn("Mirror check skipped (no config)"); return false; }
   try {
     const resp = await fetch(cfg.mirror.baseUrl + "/skill/products/search?limit=1", {
-      headers: { "X-API-Key": cfg.mirror.apiKey, "ngrok-skip-browser-warning": "true" },
+      headers: { "X-API-Key": cfg.mirror.apiKey },
       signal: AbortSignal.timeout(8000),
     });
     if (resp.ok) { ok("Mirror API reachable"); return true; }
diff --git a/new/scripts/lib/vas-model.js b/new/scripts/lib/vas-model.js
new file mode 100644
index 0000000..35bd6a9
--- /dev/null
+++ b/new/scripts/lib/vas-model.js
@@ -0,0 +1,442 @@
+"use strict";
+
+const VALID_PLATFORMS = new Set(["alipay", "app", "wechat", "h5", "dy", "ks", "jd"]);
+const METADATA_FIELDS = ["describe", "disclaimer", "protectionScope", "claimProcess", "specialInstruction", "picDesc"];
+
+function isPlainObject(value) {
+  return typeof value === "object" && value !== null && !Array.isArray(value);
+}
+
+function hasOwn(value, key) {
+  return Object.prototype.hasOwnProperty.call(value || {}, key);
+}
+
+function normalizeMetadata(source) {
+  const metadata = isPlainObject(source && source.metadata) ? source.metadata : {};
+  return {
+    describe: String(metadata.describe ?? source?.describe ?? ""),
+    disclaimer: String(metadata.disclaimer ?? source?.disclaimer ?? ""),
+    protectionScope: String(metadata.protectionScope ?? source?.protection_scope ?? source?.protectionScope ?? ""),
+    claimProcess: String(metadata.claimProcess ?? source?.claim_process ?? source?.claimProcess ?? ""),
+    specialInstruction: String(metadata.specialInstruction ?? source?.special_intruction ?? source?.specialInstruction ?? ""),
+    picDesc: String(metadata.picDesc ?? source?.pic_desc ?? source?.picDesc ?? ""),
+  };
+}
+
+function normalizeCatalogService(service) {
+  if (!isPlainObject(service)) return null;
+  const id = String(service.id ?? service.serviceId ?? "").trim();
+  if (!id) return null;
+  return {
+    id,
+    serviceName: String(service.serviceName ?? service.service_name ?? service.name ?? ""),
+    serviceMoney: String(service.serviceMoney ?? service.service_money ?? service.money ?? ""),
+    metadata: normalizeMetadata(service),
+  };
+}
+
+function normalizeStateService(service) {
+  const catalogService = normalizeCatalogService(service);
+  if (!catalogService) return null;
+  return {
+    ...catalogService,
+    defaultSelected: service.defaultSelected === true || String(service.defaultSelected) === "1",
+    isForce: service.isForce === true || String(service.isForce ?? service.is_force) === "1",
+    isPopup: service.isPopup === true || String(service.isPopup ?? service.is_popup) === "1",
+  };
+}
+
+function normalizeState(state) {
+  const source = isPlainObject(state) ? state : {};
+  return {
+    enabled: source.enabled === true || String(source.enabled) === "1",
+    platforms: Array.isArray(source.platforms) ? source.platforms.map(value => String(value).trim()).filter(Boolean) : [],
+    services: Array.isArray(source.services) ? source.services.map(normalizeStateService).filter(Boolean) : [],
+  };
+}
+
+function normalizePlanService(service, errors, path) {
+  if (!isPlainObject(service)) {
+    errors.push(path + " must be an object with a service id");
+    return null;
+  }
+  const id = String(service.id ?? "").trim();
+  if (!id) {
+    errors.push(path + ".id is required; service names cannot be used as keys");
+    return null;
+  }
+  const normalized = { id };
+  for (const field of ["defaultSelected", "isForce", "isPopup"]) {
+    if (!hasOwn(service, field)) continue;
+    if (typeof service[field] !== "boolean") {
+      errors.push(path + "." + field + " must be boolean");
+      continue;
+    }
+    normalized[field] = service[field];
+  }
+  for (const field of ["expectedName", "expectedMoney"]) {
+    if (!hasOwn(service, field)) continue;
+    if (typeof service[field] !== "string") {
+      errors.push(path + "." + field + " must be a string");
+      continue;
+    }
+    normalized[field] = service[field];
+  }
+  if (normalized.isForce === true) {
+    if (hasOwn(service, "defaultSelected") && service.defaultSelected === false) {
+      errors.push(path + ": isForce=true requires defaultSelected=true");
+    } else if (!hasOwn(normalized, "defaultSelected")) {
+      normalized.defaultSelected = true;
+    }
+  }
+  return normalized;
+}
+
+function findDuplicateIds(services) {
+  const seen = new Set();
+  const duplicates = new Set();
+  for (const service of services) {
+    if (seen.has(service.id)) duplicates.add(service.id);
+    seen.add(service.id);
+  }
+  return [...duplicates];
+}
+
+function normalizeVASPlan(plan) {
+  if (!isPlainObject(plan)) return {};
+  const normalized = {};
+  const errors = [];
+
+  if (hasOwn(plan, "enabled")) {
+    if (typeof plan.enabled !== "boolean") errors.push("VAS enabled must be boolean");
+    else normalized.enabled = plan.enabled;
+  }
+  if (hasOwn(plan, "platforms")) {
+    if (!Array.isArray(plan.platforms)) {
+      errors.push("VAS platforms must be an array");
+    } else {
+      normalized.platforms = plan.platforms.map(value => String(value).trim()).filter(Boolean);
+      const duplicatePlatforms = normalized.platforms.filter((value, index, all) => all.indexOf(value) !== index);
+      if (duplicatePlatforms.length > 0) errors.push("Duplicate VAS platforms: " + [...new Set(duplicatePlatforms)].join(", "));
+    }
+  }
+
+  if (hasOwn(plan, "services") && !isPlainObject(plan.services)) {
+    errors.push("VAS services must be an object");
+  } else if (isPlainObject(plan.services)) {
+    const services = {};
+    const hasSet = hasOwn(plan.services, "set");
+    const hasPatch = hasOwn(plan.services, "upsert") || hasOwn(plan.services, "remove");
+    if (hasSet && hasPatch) errors.push("VAS services.set cannot be combined with services.upsert/remove");
+
+    if (hasSet) {
+      if (!Array.isArray(plan.services.set)) {
+        errors.push("VAS services.set must be an array");
+      } else {
+        services.set = plan.services.set.map((service, index) => normalizePlanService(service, errors, "services.set[" + index + "]")).filter(Boolean);
+        const duplicates = findDuplicateIds(services.set);
+        if (duplicates.length > 0) errors.push("Duplicate VAS service IDs in services.set: " + duplicates.join(", "));
+      }
+    }
+    if (hasOwn(plan.services, "upsert")) {
+      if (!Array.isArray(plan.services.upsert)) {
+        errors.push("VAS services.upsert must be an array");
+      } else {
+        services.upsert = plan.services.upsert.map((service, index) => normalizePlanService(service, errors, "services.upsert[" + index + "]")).filter(Boolean);
+        const duplicates = findDuplicateIds(services.upsert);
+        if (duplicates.length > 0) errors.push("Duplicate VAS service IDs in services.upsert: " + duplicates.join(", "));
+      }
+    }
+    if (hasOwn(plan.services, "remove")) {
+      if (!Array.isArray(plan.services.remove)) {
+        errors.push("VAS services.remove must be an array");
+      } else {
+        services.remove = [];
+        for (let index = 0; index < plan.services.remove.length; index++) {
+          const value = plan.services.remove[index];
+          if (isPlainObject(value) && !hasOwn(value, "id")) {
+            errors.push("services.remove[" + index + "].id is required");
+            continue;
+          }
+          const id = String(isPlainObject(value) ? value.id ?? "" : value).trim();
+          if (!id) {
+            errors.push("services.remove[" + index + "] must contain a service id");
+            continue;
+          }
+          services.remove.push(id);
+        }
+        const duplicateRemoves = services.remove.filter((value, index, all) => all.indexOf(value) !== index);
+        if (duplicateRemoves.length > 0) errors.push("Duplicate VAS service IDs in services.remove: " + [...new Set(duplicateRemoves)].join(", "));
+      }
+    }
+    if (services.upsert && services.remove) {
+      const removed = new Set(services.remove);
+      const conflicts = services.upsert.map(service => service.id).filter(id => removed.has(id));
+      if (conflicts.length > 0) errors.push("VAS service IDs cannot be both upserted and removed: " + conflicts.join(", "));
+    }
+    normalized.services = services;
+  }
+
+  if (errors.length > 0) normalized.errors = errors;
+  return normalized;
+}
+
+function hasVASOps(plan) {
+  return Boolean(plan && (
+    (Array.isArray(plan.errors) && plan.errors.length > 0) ||
+    hasOwn(plan, "enabled") ||
+    hasOwn(plan, "platforms") ||
+    (isPlainObject(plan.services) && (hasOwn(plan.services, "set") || hasOwn(plan.services, "upsert") || hasOwn(plan.services, "remove")))
+  ));
+}
+
+function catalogMap(catalog) {
+  return new Map((Array.isArray(catalog) ? catalog : []).map(normalizeCatalogService).filter(Boolean).map(service => [service.id, service]));
+}
+
+function validateVASPlan(plan, currentState, catalog) {
+  const normalized = normalizeVASPlan(plan);
+  const current = normalizeState(currentState);
+  const errors = [...(normalized.errors || [])];
+  const warnings = [];
+  const available = catalogMap(catalog);
+
+  if (normalized.platforms) {
+    for (const platform of normalized.platforms) {
+      if (!VALID_PLATFORMS.has(platform)) errors.push("Invalid VAS platform: " + platform);
+    }
+  }
+
+  const plannedServices = normalized.services?.set || normalized.services?.upsert || [];
+  for (const service of plannedServices) {
+    const found = available.get(service.id);
+    if (!found) {
+      errors.push("VAS service does not exist in catalog: " + service.id);
+      continue;
+    }
+    if (hasOwn(service, "expectedName") && service.expectedName !== found.serviceName) {
+      errors.push("VAS service " + service.id + " expectedName mismatch: expected " + JSON.stringify(service.expectedName) + ", catalog has " + JSON.stringify(found.serviceName));
+    }
+    if (hasOwn(service, "expectedMoney") && service.expectedMoney !== found.serviceMoney) {
+      errors.push("VAS service " + service.id + " expectedMoney mismatch: expected " + JSON.stringify(service.expectedMoney) + ", catalog has " + JSON.stringify(found.serviceMoney));
+    }
+  }
+
+  const changesServices = Boolean(normalized.services && (
+    hasOwn(normalized.services, "set") ||
+    (normalized.services.upsert && normalized.services.upsert.length > 0) ||
+    (normalized.services.remove && normalized.services.remove.length > 0)
+  ));
+  if (!current.enabled && changesServices && normalized.enabled !== true) {
+    errors.push("VAS service changes on a disabled product require enabled=true explicitly");
+  }
+
+  const target = buildTargetVASState(current, normalized, catalog);
+  if (target.enabled && target.platforms.length === 0) errors.push("Enabled VAS requires at least one platform");
+  if (target.enabled && target.services.length === 0) warnings.push("VAS is enabled with no selected services");
+
+  const popupIds = target.services.filter(service => service.isPopup).map(service => service.id);
+  if (popupIds.length > 1) errors.push("At most one VAS service may have isPopup=true: " + popupIds.join(", "));
+  for (const service of target.services) {
+    if (service.isForce && !service.defaultSelected) errors.push("VAS service " + service.id + ": isForce=true requires defaultSelected=true");
+    if (service.isForce && service.isPopup) errors.push("VAS service " + service.id + ": isForce=true requires isPopup=false");
+  }
+
+  return { ok: errors.length === 0, errors, warnings, plan: normalized, target };
+}
+
+function materializeService(planService, existing, catalogService) {
+  const source = catalogService || existing || { id: planService.id, serviceName: "", serviceMoney: "", metadata: normalizeMetadata({}) };
+  return {
+    id: planService.id,
+    serviceName: source.serviceName,
+    serviceMoney: source.serviceMoney,
+    defaultSelected: hasOwn(planService, "defaultSelected") ? planService.defaultSelected : Boolean(existing && existing.defaultSelected),
+    isForce: hasOwn(planService, "isForce") ? planService.isForce : Boolean(existing && existing.isForce),
+    isPopup: hasOwn(planService, "isPopup") ? planService.isPopup : Boolean(existing && existing.isPopup),
+    metadata: normalizeMetadata(source),
+  };
+}
+
+function buildTargetVASState(currentState, plan, catalog) {
+  const current = normalizeState(currentState);
+  const normalized = normalizeVASPlan(plan);
+  const available = catalogMap(catalog);
+  const currentById = new Map(current.services.map(service => [service.id, service]));
+  const target = {
+    enabled: hasOwn(normalized, "enabled") ? normalized.enabled : current.enabled,
+    platforms: hasOwn(normalized, "platforms") ? [...normalized.platforms] : [...current.platforms],
+    services: current.services.map(service => ({ ...service, metadata: { ...service.metadata } })),
+  };
+
+  if (normalized.services && hasOwn(normalized.services, "set")) {
+    target.services = normalized.services.set.map(service => materializeService(service, currentById.get(service.id), available.get(service.id)));
+  } else if (normalized.services) {
+    const removeIds = new Set(normalized.services.remove || []);
+    target.services = target.services.filter(service => !removeIds.has(service.id));
+    const indexById = new Map(target.services.map((service, index) => [service.id, index]));
+    for (const service of normalized.services.upsert || []) {
+      const existingIndex = indexById.get(service.id);
+      const existing = existingIndex === undefined ? currentById.get(service.id) : target.services[existingIndex];
+      const materialized = materializeService(service, existing, available.get(service.id));
+      if (existingIndex === undefined) {
+        indexById.set(service.id, target.services.length);
+        target.services.push(materialized);
+      } else {
+        target.services[existingIndex] = materialized;
+      }
+    }
+  }
+  return target;
+}
+
+function validateVASTargetState(state) {
+  const source = isPlainObject(state) ? state : {};
+  const target = normalizeState(source);
+  const errors = [];
+  const warnings = [];
+
+  if (!hasOwn(source, "enabled") || typeof source.enabled !== "boolean") errors.push("VAS target.enabled boolean is required");
+  if (!Array.isArray(source.platforms)) errors.push("VAS target.platforms array is required");
+  if (!Array.isArray(source.services)) errors.push("VAS target.services array is required");
+
+  const rawPlatforms = Array.isArray(source.platforms) ? source.platforms : [];
+  for (let index = 0; index < rawPlatforms.length; index++) {
+    if (typeof rawPlatforms[index] !== "string" || rawPlatforms[index].trim() === "") {
+      errors.push("VAS target.platforms[" + index + "] must be a non-empty string");
+    }
+  }
+  for (const platform of target.platforms) {
+    if (!VALID_PLATFORMS.has(platform)) errors.push("Invalid VAS platform: " + platform);
+  }
+  const duplicatePlatforms = target.platforms.filter((value, index, all) => all.indexOf(value) !== index);
+  if (duplicatePlatforms.length > 0) errors.push("Duplicate VAS platforms: " + [...new Set(duplicatePlatforms)].join(", "));
+
+  const rawServices = Array.isArray(source.services) ? source.services : [];
+  if (rawServices.length !== target.services.length) errors.push("VAS target contains a service without a valid id");
+  for (let index = 0; index < rawServices.length; index++) {
+    const service = rawServices[index];
+    if (!isPlainObject(service)) {
+      errors.push("VAS target.services[" + index + "] must be an object");
+      continue;
+    }
+    if (typeof service.id !== "string" || service.id.trim() === "") errors.push("VAS target.services[" + index + "].id non-empty string is required");
+    for (const field of ["serviceName", "serviceMoney"]) {
+      if (typeof service[field] !== "string") errors.push("VAS target.services[" + index + "]." + field + " string is required");
+    }
+    for (const field of ["defaultSelected", "isForce", "isPopup"]) {
+      if (typeof service[field] !== "boolean") errors.push("VAS target.services[" + index + "]." + field + " boolean is required");
+    }
+    if (!isPlainObject(service.metadata)) {
+      errors.push("VAS target.services[" + index + "].metadata object is required");
+    } else {
+      for (const field of METADATA_FIELDS) {
+        if (typeof service.metadata[field] !== "string") errors.push("VAS target.services[" + index + "].metadata." + field + " string is required");
+      }
+    }
+  }
+  const duplicateIds = findDuplicateIds(target.services);
+  if (duplicateIds.length > 0) errors.push("Duplicate VAS service IDs in target state: " + duplicateIds.join(", "));
+  if (target.enabled && target.platforms.length === 0) errors.push("Enabled VAS requires at least one platform");
+  if (target.enabled && target.services.length === 0) warnings.push("VAS is enabled with no selected services");
+
+  const popupIds = target.services.filter(service => service.isPopup).map(service => service.id);
+  if (popupIds.length > 1) errors.push("At most one VAS service may have isPopup=true: " + popupIds.join(", "));
+  for (const service of target.services) {
+    if (service.isForce && !service.defaultSelected) errors.push("VAS service " + service.id + ": isForce=true requires defaultSelected=true");
+    if (service.isForce && service.isPopup) errors.push("VAS service " + service.id + ": isForce=true requires isPopup=false");
+  }
+
+  return { ok: errors.length === 0, errors, warnings, target };
+}
+
+function compareVASState(actual, expected) {
+  const left = normalizeState(actual);
+  const right = normalizeState(expected);
+  const checks = [];
+  checks.push({ field: "enabled", expected: right.enabled, actual: left.enabled, match: left.enabled === right.enabled });
+  const leftPlatforms = [...new Set(left.platforms)].sort();
+  const rightPlatforms = [...new Set(right.platforms)].sort();
+  checks.push({ field: "platforms", expected: rightPlatforms, actual: leftPlatforms, match: JSON.stringify(leftPlatforms) === JSON.stringify(rightPlatforms) });
+  checks.push({ field: "serviceIds", expected: right.services.map(service => service.id), actual: left.services.map(service => service.id), match: JSON.stringify(left.services.map(service => service.id)) === JSON.stringify(right.services.map(service => service.id)) });
+
+  const max = Math.max(left.services.length, right.services.length);
+  for (let index = 0; index < max; index++) {
+    const actualService = left.services[index];
+    const expectedService = right.services[index];
+    const id = expectedService?.id || actualService?.id || String(index);
+    for (const field of ["serviceName", "serviceMoney", "defaultSelected", "isForce", "isPopup"]) {
+      const actualValue = actualService && actualService[field];
+      const expectedValue = expectedService && expectedService[field];
+      checks.push({ field: "services[" + index + "]." + field, serviceId: id, expected: expectedValue, actual: actualValue, match: actualValue === expectedValue });
+    }
+    for (const field of METADATA_FIELDS) {
+      const actualValue = actualService && actualService.metadata && actualService.metadata[field];
+      const expectedValue = expectedService && expectedService.metadata && expectedService.metadata[field];
+      checks.push({ field: "services[" + index + "].metadata." + field, serviceId: id, expected: expectedValue, actual: actualValue, match: actualValue === expectedValue });
+    }
+  }
+  const mismatches = checks.filter(check => !check.match);
+  return {
+    match: mismatches.length === 0,
+    total: checks.length,
+    matched: checks.length - mismatches.length,
+    mismatched: mismatches.length,
+    checks,
+    mismatches,
+  };
+}
+
+function serviceSummary(service) {
+  if (!service) return "(not selected)";
+  const metadata = METADATA_FIELDS.map(field => field + "=" + JSON.stringify(service.metadata?.[field] || "")).join(" / ");
+  return service.serviceName + " / " + service.serviceMoney + " / default=" + service.defaultSelected + " / force=" + service.isForce + " / popup=" + service.isPopup + " / " + metadata;
+}
+
+function buildVASDiff(currentState, targetState) {
+  const current = normalizeState(currentState);
+  const target = normalizeState(targetState);
+  const diff = [];
+  if (current.enabled !== target.enabled) {
+    diff.push({ specId: "(vas)", field: "enabled", old: String(current.enabled), new: String(target.enabled), change: "VAS", status: "ok", scope: "vas" });
+  }
+  const currentPlatforms = [...new Set(current.platforms)].sort();
+  const targetPlatforms = [...new Set(target.platforms)].sort();
+  if (JSON.stringify(currentPlatforms) !== JSON.stringify(targetPlatforms)) {
+    diff.push({ specId: "(vas)", field: "platforms", old: currentPlatforms.join(","), new: targetPlatforms.join(","), change: "VAS", status: "ok", scope: "vas" });
+  }
+
+  const currentById = new Map(current.services.map((service, index) => [service.id, { service, index }]));
+  const targetById = new Map(target.services.map((service, index) => [service.id, { service, index }]));
+  for (const { service, index } of currentById.values()) {
+    if (!targetById.has(service.id)) {
+      diff.push({ specId: "(vas:" + service.id + ")", field: "service", old: serviceSummary(service), new: "(not selected)", operation: "remove", change: "VAS", status: "ok", scope: "vas", oldIndex: index });
+    }
+  }
+  for (const { service, index } of targetById.values()) {
+    const before = currentById.get(service.id);
+    if (!before) {
+      diff.push({ specId: "(vas:" + service.id + ")", field: "service", old: "(not selected)", new: serviceSummary(service), operation: "add", change: "VAS", status: "ok", scope: "vas", newIndex: index });
+      continue;
+    }
+    const changed = before.index !== index ||
+      ["serviceName", "serviceMoney", "defaultSelected", "isForce", "isPopup"].some(field => before.service[field] !== service[field]) ||
+      METADATA_FIELDS.some(field => before.service.metadata?.[field] !== service.metadata?.[field]);
+    if (changed) {
+      diff.push({ specId: "(vas:" + service.id + ")", field: "service", old: serviceSummary(before.service), new: serviceSummary(service), operation: before.index !== index ? "reorder_or_update" : "update", change: "VAS", status: "ok", scope: "vas", oldIndex: before.index, newIndex: index });
+    }
+  }
+  return diff;
+}
+
+module.exports = {
+  VALID_PLATFORMS,
+  METADATA_FIELDS,
+  normalizeVASPlan,
+  hasVASOps,
+  validateVASPlan,
+  buildTargetVASState,
+  validateVASTargetState,
+  compareVASState,
+  buildVASDiff,
+};
diff --git a/old/scripts/mirror-search.js b/new/scripts/mirror-search.js
index a9cb4cb..a2e52cb 100644
--- a/old/scripts/mirror-search.js
+++ b/new/scripts/mirror-search.js
@@ -39,7 +39,7 @@ function request(method, endpoint, body) {
     const url = new URL(endpoint, baseUrl);
     const opts = {
       hostname: url.hostname, port: url.port, path: url.pathname + url.search,
-      method, headers: { "X-API-Key": apiKey, "ngrok-skip-browser-warning": "true" },
+      method, headers: { "X-API-Key": apiKey },
     };
     if (body) { opts.headers["Content-Type"] = "application/json"; }
     const req = https.request(opts, (res) => {
@@ -79,7 +79,11 @@ function skuToFieldName(skuKey) {
     "搴撳瓨": "stock", "甯傚満浠?: "marketPrice", "鎶奸噾": "deposit",
     "璐拱浠?: "purchasePrice", "閲囪喘浠?: "costPrice", "璐拱灏炬": "finalPayment",
   };
-  return map[skuKey] || null;
+  if (map[skuKey]) return map[skuKey];
+  // Dynamic fallback: "N澶╃閲? 鈫?rent{N}day (covers any custom rent period)
+  const match = skuKey.match(/^(\d+)澶╃閲?/);
+  if (match) return "rent" + match[1] + "day";
+  return null;
 }
 
 function formatPrice(val) {
@@ -145,16 +149,40 @@ function reverseFieldMap() {
   return map;
 }
 
+function buildMirrorFieldUpdates(changes) {
+  const reverseMap = reverseFieldMap();
+  const skuFields = {};
+  const unmappedFields = [];
+  for (const [field, value] of Object.entries(changes || {})) {
+    const rentMatch = field.match(/^rent(\d+)day$/);
+    const mirrorField = reverseMap[field] || (rentMatch ? rentMatch[1] + "澶╃閲? : null);
+    if (!mirrorField) unmappedFields.push(field);
+    else skuFields[mirrorField] = String(value);
+  }
+  if (unmappedFields.length > 0) return { ok: false, skuFields: {}, unmappedFields };
+  return { ok: true, skuFields, unmappedFields: [] };
+}
+
 function isNestedChanges(changes) {
   const firstVal = Object.values(changes || {})[0];
   return typeof firstVal === "object" && firstVal !== null && !Array.isArray(firstVal);
 }
 
-async function writebackItems(items) {
+function buildMirrorWritebackPayload(productId, skuUpdates, verificationAt) {
+  return { goods_id: productId, sku_updates: skuUpdates, source: "saas_verify", verified_at: verificationAt };
+}
+
+function resolveVerifiedWritebackTimestamp(state) {
+  if (!state || state.status !== "delayed_verified") return { ok: false, message: "Writeback requires delayed_verified state" };
+  const verificationAt = String(state && state.delayedVerify && state.delayedVerify.at || "").trim();
+  if (!verificationAt || !Number.isFinite(Date.parse(verificationAt))) return { ok: false, message: "Writeback requires a valid delayedVerify.at timestamp" };
+  return { ok: true, verificationAt };
+}
+
+async function writebackItems(items, verificationAt) {
   if (items.length === 0) die("No items to write back");
   log("Writeback " + items.length + " products to mirror...");
 
-  const reverseMap = reverseFieldMap();
   const results = [];
   for (const item of items) {
     const pid = item.productId;
@@ -165,29 +193,24 @@ async function writebackItems(items) {
     }
     const changes = rawChanges;
     if (Object.keys(changes).length === 0) { results.push({ productId: pid, status: "skipped", reason: "no changes" }); continue; }
+    const fieldUpdates = buildMirrorFieldUpdates(changes);
+    if (!fieldUpdates.ok) {
+      results.push({ productId: pid, status: "error", reason: "unmapped fields", unmappedFields: fieldUpdates.unmappedFields });
+      continue;
+    }
+    const skuFields = fieldUpdates.skuFields;
 
     // Get mirror data (for SKU strings)
     const detail = await batchDetail([pid]);
     const product = detail.data[0];
     if (!product || !product.skus || product.skus.length === 0) { results.push({ productId: pid, status: "error", reason: "not in mirror" }); continue; }
 
-    // Map field names and build sku_updates
-    const skuFields = {};
-    for (const [enField, val] of Object.entries(changes)) {
-      const cnField = reverseMap[enField];
-      if (cnField) skuFields[cnField] = String(val);
-    }
-
     if (Object.keys(skuFields).length === 0) { results.push({ productId: pid, status: "skipped", reason: "no mappable fields" }); continue; }
 
     const skuUpdates = product.skus.map(sku => ({ SKU: sku.SKU, fields: skuFields }));
 
     try {
-      const resp = await request("POST", "/skill/products/update-local", {
-        goods_id: pid,
-        sku_updates: skuUpdates,
-        source: "rental-price-agent",
-      });
+      const resp = await request("POST", "/skill/products/update-local", buildMirrorWritebackPayload(pid, skuUpdates, verificationAt));
       results.push({ productId: pid, status: resp.status || "ok", updated: resp.updated_sku_count, rows: resp.updated_row_count, missing: resp.missing_skus });
       log("  " + pid + ": " + resp.updated_sku_count + " SKUs / " + resp.updated_row_count + " rows");
     } catch (err) {
@@ -251,9 +274,11 @@ async function main() {
       const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
       if (state.status !== "delayed_verified") die("Writeback requires delayed_verified state");
       if ((state.verifyFailed || []).length > 0 || (state.failed || []).length > 0) die("Writeback requires no failed or verifyFailed items");
-      const completedIds = new Set((state.completed || []).map(x => String(x.productId)));
+      const timestampDecision = resolveVerifiedWritebackTimestamp(state);
+      if (!timestampDecision.ok) die(timestampDecision.message);
+      const completedIds = new Set((state.completed || []).filter(entry => entry && entry.status !== "preview_only").map(x => String(x.productId)));
       const items = (state.spec && state.spec.items ? state.spec.items : []).filter(item => completedIds.has(String(item.productId)));
-      await writebackItems(items);
+      await writebackItems(items, timestampDecision.verificationAt);
       break;
     }
     default:
@@ -261,4 +286,20 @@ async function main() {
   }
 }
 
-main().catch(err => { die(err.message); });
+if (require.main === module) {
+  main().catch(err => { die(err.message); });
+} else {
+  module.exports = {
+    normalizeText,
+    extractNumericPrices,
+    isLinkPrice,
+    isMqMaintainedProduct,
+    hasLinkPriceSku,
+    classifyProductExclusion,
+    filterSearchDetails,
+    skuToFieldName,
+    buildMirrorWritebackPayload,
+    buildMirrorFieldUpdates,
+    resolveVerifiedWritebackTimestamp,
+  };
+}
diff --git a/old/scripts/playwright-runner.js b/new/scripts/playwright-runner.js
index 1b74184..c576e50 100644
--- a/old/scripts/playwright-runner.js
+++ b/new/scripts/playwright-runner.js
@@ -25,7 +25,10 @@ const net = require("net");
 const crypto = require("crypto");
 
 const { loadConfig, SKILL_DIR } = require("./lib/config-loader");
-const USER_DATA_DIR = SKILL_DIR + "/.browser-data";
+const { validateVASTargetState, compareVASState } = require("./lib/vas-model");
+const USER_DATA_DIR = process.env.RENTAL_AGENT_USER_DATA_DIR
+  ? path.resolve(process.env.RENTAL_AGENT_USER_DATA_DIR)
+  : SKILL_DIR + "/.browser-data";
 const OUTPUT_DIR = SKILL_DIR + "/tasks";
 const PID_FILE = SKILL_DIR + "/.daemon.pid";
 const PORT_FILE = SKILL_DIR + "/.daemon.port";
@@ -70,20 +73,1626 @@ function resolveSelector(selectorTemplate, specId) {
 
 function getProductFields() {
   const sel = config.selectors.product;
-  const skipKeys = ["_note", "saveButton", "saveSuccessToast", "specTable", "goodsName"];
+  const skipKeys = ["_note", "saveButton", "saveSuccessToast", "specTable", "goodsName", "_dynamicFields"];
   return Object.keys(sel).filter(k => typeof sel[k] === "string" && sel[k] !== null && !skipKeys.includes(k));
 }
 
+// --- Dynamic rent field discovery ---
+function getDynamicRentConfig() {
+  const df = config.selectors.product._dynamicFields;
+  if (!df || !df.rentDays) return null;
+  return df.rentDays;
+}
+
+function isDynamicRentField(field) {
+  return /^rent\d+day$/.test(field);
+}
+
+function resolveDynamicRentSelector(field, specId) {
+  const dynConfig = getDynamicRentConfig();
+  if (!dynConfig) return null;
+  const match = field.match(/^rent(\d+)day$/);
+  if (!match) return null;
+  const days = match[1];
+  return dynConfig.selectorTemplate
+    .replace(/\{days\}/g, days)
+    .replace(/\{specId\}/g, specId);
+}
+
+function resolveFieldSelector(field, specId) {
+  const staticTemplate = config.selectors.product[field];
+  if (staticTemplate) return resolveSelector(staticTemplate, specId);
+  if (isDynamicRentField(field)) return resolveDynamicRentSelector(field, specId);
+  return null;
+}
+
+// Scan a spec row for all rent inputs, return { rentNday: daysInt }
+async function discoverRentFieldsForSpec(scope, specId) {
+  const dynConfig = getDynamicRentConfig();
+  if (!dynConfig) return {};
+  return await scope.evaluate((params) => {
+    const reg = new RegExp(params.extractRegexStr);
+    const rows = document.querySelectorAll("#options table tbody tr");
+    let targetRow = null;
+    for (const row of rows) {
+      const idEl = row.querySelector("input.option_ids");
+      if (idEl && idEl.value.trim() === String(params.specId)) {
+        targetRow = row;
+        break;
+      }
+    }
+    if (!targetRow) return {};
+    const inputs = targetRow.querySelectorAll(params.scanSel);
+    const result = {};
+    for (const input of inputs) {
+      const className = input.className || "";
+      const match = className.match(reg);
+      if (!match) continue;
+      const days = match[1];
+      const fieldName = params.fieldTemplate.replace(/\{days\}/g, days);
+      result[fieldName] = parseInt(days, 10);
+    }
+    return result;
+  }, {
+    specId,
+    scanSel: dynConfig.scanSelector,
+    extractRegexStr: dynConfig.extractDaysRegex,
+    fieldTemplate: dynConfig.fieldTemplate
+  });
+}
+
 function getCurrentProductIdFromUrl() {
   const match = page.url().match(/[?&]id=(\d+)/);
   return match ? match[1] : null;
 }
 
+function checkExpectedProductUrl(url, expectedProductId, productDetailUrlTemplate) {
+  const expected = String(expectedProductId ?? "").trim();
+  const currentUrlText = String(url || "");
+  if (!/^[1-9]\d*$/.test(expected)) {
+    return { ok: false, currentProductId: null, expectedProductId: expected, url: currentUrlText, reason: "invalid_expected_product_id" };
+  }
+  try {
+    const currentUrl = new URL(currentUrlText);
+    const expectedUrl = new URL(String(productDetailUrlTemplate || "").replace("{productId}", expected));
+    const currentProductId = currentUrl.searchParams.get("id");
+    const ok = currentUrl.origin === expectedUrl.origin
+      && currentUrl.pathname === expectedUrl.pathname
+      && currentUrl.searchParams.get("r") === "goods.edit"
+      && expectedUrl.searchParams.get("r") === "goods.edit"
+      && currentProductId === expected;
+    return { ok, currentProductId, expectedProductId: expected, url: currentUrlText };
+  } catch {
+    return { ok: false, currentProductId: null, expectedProductId: expected, url: currentUrlText, reason: "invalid_product_url" };
+  }
+}
+
 function assertCurrentProduct(expectedProductId) {
   if (!expectedProductId) return { ok: true, currentProductId: getCurrentProductIdFromUrl(), url: page.url() };
-  const currentProductId = getCurrentProductIdFromUrl();
-  const ok = String(currentProductId || "") === String(expectedProductId);
-  return { ok, currentProductId, expectedProductId: String(expectedProductId), url: page.url() };
+  return checkExpectedProductUrl(page.url(), expectedProductId, config && config.saas && config.saas.productDetailUrl);
+}
+
+function validateProductPageAfterNavigation(url, expectedProductId, productDetailUrlTemplate, currentPage) {
+  const currentCheck = checkExpectedProductUrl(url, expectedProductId, productDetailUrlTemplate);
+  if (!currentCheck.ok) return { status: "error", message: "Current page product mismatch", ...currentCheck };
+  return { status: "ok", productId: currentCheck.currentProductId, currentPage: Boolean(currentPage) };
+}
+
+function checkSaasOrigin(url, trustedUrl) {
+  try {
+    const current = new URL(String(url || ""));
+    const trusted = new URL(String(trustedUrl || ""));
+    return { ok: current.origin === trusted.origin, origin: current.origin, expectedOrigin: trusted.origin, url: current.toString() };
+  } catch {
+    return { ok: false, origin: "", expectedOrigin: "", url: String(url || ""), reason: "invalid_url" };
+  }
+}
+
+function checkConfiguredPage(url, expectedUrl) {
+  try {
+    const current = new URL(String(url || ""));
+    const expected = new URL(String(expectedUrl || ""));
+    const expectedRoute = expected.searchParams.get("r");
+    const ok = current.origin === expected.origin
+      && current.pathname === expected.pathname
+      && (!expectedRoute || current.searchParams.get("r") === expectedRoute);
+    return { ok, url: current.toString(), origin: current.origin, expectedOrigin: expected.origin, pathname: current.pathname, expectedPathname: expected.pathname };
+  } catch {
+    return { ok: false, url: String(url || ""), reason: "invalid_configured_page_url" };
+  }
+}
+
+function validateCopyDestination(url, expectedProductId, productDetailUrlTemplate) {
+  const expected = String(expectedProductId ?? "").trim();
+  if (!/^[1-9]\d*$/.test(expected)) return { ok: false, expectedProductId: expected, reason: "invalid_expected_product_id" };
+  try {
+    const current = new URL(String(url || ""));
+    const trusted = new URL(String(productDetailUrlTemplate || "").replace("{productId}", expected));
+    const route = current.searchParams.get("r");
+    const currentProductId = current.searchParams.get("id");
+    const ok = current.origin === trusted.origin
+      && current.pathname === trusted.pathname
+      && (route === "goods.edit" || route === "goods.copy")
+      && currentProductId === expected;
+    return { ok, route, currentProductId, expectedProductId: expected, url: current.toString() };
+  } catch {
+    return { ok: false, expectedProductId: expected, url: String(url || ""), reason: "invalid_copy_url" };
+  }
+}
+
+function validateSubmitCommand(cmd) {
+  if (!cmd || cmd.action !== "submit") return null;
+  const expectedProductId = String(cmd.expectedProductId ?? "").trim();
+  if (!/^[1-9]\d*$/.test(expectedProductId)) return { status: "error", message: "submit requires a canonical positive expectedProductId" };
+  return { status: "ok", expectedProductId };
+}
+
+function buildLegacyApplySubmitDecision(applyResult, submitRequested) {
+  if (!submitRequested) return { shouldSubmit: false, submitResult: null };
+  const applyStatus = applyResult && applyResult.status ? applyResult.status : "unknown";
+  if (applyStatus === "ok") return { shouldSubmit: true, submitResult: null };
+  return { shouldSubmit: false, submitResult: { status: "skipped", reason: "apply_status_not_ok", applyStatus } };
+}
+
+function mergeLegacyApplySubmitOutcome(applyResult, submitResult) {
+  const merged = { ...(applyResult || {}), submit: submitResult };
+  if (!submitResult || submitResult.status === "ok") {
+    merged.status = "ok";
+    return merged;
+  }
+  if (submitResult.status === "unknown") {
+    merged.status = "unknown";
+    merged.sideEffectPossible = submitResult.sideEffectPossible === true;
+    merged.retrySafe = submitResult.retrySafe === true;
+    return merged;
+  }
+  if (submitResult.status === "error") {
+    merged.status = "error";
+    if (submitResult.sideEffectPossible !== undefined) merged.sideEffectPossible = submitResult.sideEffectPossible;
+    if (submitResult.retrySafe !== undefined) merged.retrySafe = submitResult.retrySafe;
+    return merged;
+  }
+  return merged;
+}
+
+function compareLegacyVerification(readResult, expectedChanges) {
+  if (!readResult || readResult.status === "error" || !readResult.values) {
+    return { status: "error", matches: {}, mismatches: [], message: readResult && readResult.message ? readResult.message : "readback returned no values" };
+  }
+  const expected = expectedChanges || {};
+  const firstExpected = Object.values(expected)[0];
+  const nested = firstExpected && typeof firstExpected === "object" && !Array.isArray(firstExpected);
+  const matches = {};
+  const mismatches = [];
+  const compareField = (specId, field, expectedValue, actualValues, missingSpec) => {
+    if (!matches[specId]) matches[specId] = {};
+    const actual = actualValues ? actualValues[field] : undefined;
+    const match = !missingSpec && actual !== undefined && actual === String(expectedValue);
+    matches[specId][field] = match;
+    if (!match) mismatches.push({ specId, field, expected: String(expectedValue), actual: missingSpec ? "(spec not found)" : (actual === undefined ? "(missing)" : actual) });
+  };
+  if (nested) {
+    for (const [specId, fields] of Object.entries(expected)) {
+      const actualValues = readResult.values[specId];
+      for (const [field, expectedValue] of Object.entries(fields || {})) compareField(specId, field, expectedValue, actualValues, !actualValues);
+    }
+  } else {
+    const specs = Object.entries(readResult.values);
+    if (specs.length === 0 && Object.keys(expected).length > 0) {
+      for (const [field, expectedValue] of Object.entries(expected)) compareField("(all)", field, expectedValue, null, true);
+    } else {
+      for (const [specId, actualValues] of specs) {
+        for (const [field, expectedValue] of Object.entries(expected)) compareField(specId, field, expectedValue, actualValues, false);
+      }
+    }
+  }
+  return { status: mismatches.length > 0 ? "mismatch" : "ok", matches, mismatches };
+}
+
+function getImageSelectors() {
+  return (config.selectors && config.selectors.image) || {};
+}
+
+async function getImageSection(sectionType) {
+  const imageSel = getImageSelectors();
+  const btnSelector = sectionType === "white" ? imageSel.whiteButton : imageSel.thumbsButton;
+  if (!btnSelector) throw new Error("Image button selector not configured for section: " + sectionType);
+  const btn = await page.$(btnSelector);
+  if (!btn) throw new Error("Image button not found for section: " + sectionType);
+  const section = await btn.evaluateHandle(el => el.closest(".form-group") || el.parentElement);
+  return { btn, section, btnSelector };
+}
+
+async function readImageSectionState(sectionType) {
+  const imageSel = getImageSelectors();
+  const { section } = await getImageSection(sectionType);
+  const state = await section.evaluate((el, inputSelector, emptyKeyword) => {
+    const items = Array.from(el.querySelectorAll(".multi-item")).map((item, index) => ({
+      index,
+      imgSrc: item.querySelector("img")?.getAttribute("src") || "",
+      inputName: item.querySelector("input")?.getAttribute("name") || "",
+      inputValue: item.querySelector("input")?.value || "",
+      hasDelete: !!item.querySelector(".BOX_IMG_UPLOAD_DELL"),
+      deleteClass: item.querySelector(".BOX_IMG_UPLOAD_DELL")?.className || ""
+    }));
+    const inputs = Array.from(el.querySelectorAll(inputSelector)).map(node => node.value || "");
+    const imgs = Array.from(el.querySelectorAll("img")).map(node => node.getAttribute("src") || "");
+    const isEmptyPlaceholder = !!emptyKeyword && imgs.length === 1 && String(imgs[0] || "").includes(emptyKeyword) && inputs.length === 0;
+    return {
+      text: (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 1200),
+      html: (el.outerHTML || "").slice(0, 20000),
+      items,
+      values: inputs,
+      imgs,
+      isEmptyPlaceholder
+    };
+  }, sectionType === "white" ? imageSel.whiteInput : imageSel.thumbsInput, imageSel.emptyPlaceholderSrcKeyword || "default-pic.jpg");
+  if (sectionType === "white") {
+    return {
+      sectionType,
+      value: state.values[0] || "",
+      values: state.values,
+      imgs: state.imgs,
+      items: state.items,
+      isEmptyPlaceholder: state.isEmptyPlaceholder,
+      text: state.text,
+      html: state.html,
+    };
+  }
+  return {
+    sectionType,
+    values: state.values,
+    imgs: state.imgs,
+    items: state.items,
+    text: state.text,
+    html: state.html,
+  };
+}
+
+async function openImageModal(sectionType) {
+  const { btn } = await getImageSection(sectionType);
+  await btn.click();
+  await page.waitForTimeout(1200);
+  const imageSel = getImageSelectors();
+  const confirmBtn = imageSel.modalConfirmButton || "span.btn.btn-primary.save";
+  await page.waitForSelector(confirmBtn, { timeout: 8000, state: "visible" });
+  return { status: "ok", sectionType };
+}
+
+async function clickImageCategory(categoryName) {
+  const imageSel = getImageSelectors();
+  const categorySelector = imageSel.materialCategory || ".box_main_left_title_main";
+  const clicked = await page.evaluate(({ categorySelector, categoryName }) => {
+    const nodes = Array.from(document.querySelectorAll(categorySelector));
+    const target = nodes.find(el => {
+      const text = (el.textContent || "").replace(/\s+/g, " ").trim();
+      return text === categoryName;
+    });
+    if (!target) return false;
+    target.click();
+    return true;
+  }, { categorySelector, categoryName });
+  if (!clicked) throw new Error("Image category not found: " + categoryName);
+  await page.waitForTimeout(1000);
+  await page.waitForLoadState("networkidle").catch(() => {});
+  return { status: "ok", categoryName };
+}
+
+async function listVisibleMaterialCards() {
+  const imageSel = getImageSelectors();
+  const cardSelector = imageSel.materialCard || "li.box_main_right_img";
+  const nameSelector = imageSel.materialCardName || ".box_name";
+  return await page.evaluate(({ cardSelector, nameSelector }) => {
+    function visible(el) {
+      if (!el) return false;
+      const r = el.getBoundingClientRect();
+      const s = getComputedStyle(el);
+      return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden";
+    }
+    return Array.from(document.querySelectorAll(cardSelector)).filter(visible).map((el, index) => ({
+      index,
+      id: el.id || "",
+      imgUrl: el.getAttribute("img_url") || "",
+      name: ((el.querySelector(nameSelector)?.textContent) || el.textContent || "").replace(/\s+/g, " ").trim(),
+      className: el.className || "",
+      style: el.getAttribute("style") || "",
+      selected: /(^|\s)on(\s|$)|selected|active|checked|cur/.test(el.className || "")
+    }));
+  }, { cardSelector, nameSelector });
+}
+
+async function markMaterialSearchControls() {
+  const imageSel = getImageSelectors();
+  const cardSelector = imageSel.materialCard || "li.box_main_right_img";
+  const confirmSelector = imageSel.modalConfirmButton || "span.btn.btn-primary.save";
+  const configuredInputSelector = imageSel.modalSearchInput || null;
+  const configuredButtonSelector = imageSel.modalSearchButton || null;
+  return await page.evaluate(({ cardSelector, confirmSelector, configuredInputSelector, configuredButtonSelector }) => {
+    function visible(el) {
+      if (!el) return false;
+      const r = el.getBoundingClientRect();
+      const s = getComputedStyle(el);
+      return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden";
+    }
+    document.querySelectorAll('[data-rpa-material-search-input],[data-rpa-material-search-button]').forEach(el => {
+      el.removeAttribute('data-rpa-material-search-input');
+      el.removeAttribute('data-rpa-material-search-button');
+    });
+
+    const configuredInput = configuredInputSelector ? Array.from(document.querySelectorAll(configuredInputSelector)).find(visible) : null;
+    const configuredButton = configuredButtonSelector ? Array.from(document.querySelectorAll(configuredButtonSelector)).find(visible) : null;
+    let root = null;
+    const visibleCard = Array.from(document.querySelectorAll(cardSelector)).find(visible) || null;
+    const visibleConfirm = Array.from(document.querySelectorAll(confirmSelector)).find(visible) || null;
+    if (visibleCard) {
+      const ancestors = [];
+      let node = visibleCard;
+      while (node && node !== document.body) {
+        ancestors.push(node);
+        node = node.parentElement;
+      }
+      root = ancestors.find(el => visibleConfirm && el.contains(visibleConfirm)) || ancestors[0] || null;
+    }
+    if (!root && visibleConfirm) root = visibleConfirm.closest('div,section,form') || visibleConfirm.parentElement;
+    const scope = root || document;
+    const textInputs = Array.from(scope.querySelectorAll("input[type='text'],input[type='search']")).filter(visible);
+    const keywordRe = /(search|鎼滅储|query|keyword|鍚嶇О|鏂囦欢鍚峾绱犳潗)/i;
+    const buttons = Array.from(scope.querySelectorAll('button,span,a')).filter(visible);
+    const resolvedInput = configuredInput || textInputs.find(el => keywordRe.test((el.id || '') + ' ' + (el.name || '') + ' ' + (el.className || '') + ' ' + (el.placeholder || '') + ' ' + (el.getAttribute('aria-label') || '')))
+      || textInputs.find(el => keywordRe.test((el.parentElement?.innerText || '').replace(/\s+/g, ' ').trim()))
+      || (textInputs.length === 1 ? textInputs[0] : null);
+    const resolvedButton = configuredButton || buttons.find(el => keywordRe.test(((el.textContent || '') + ' ' + (el.id || '') + ' ' + (el.className || '')).replace(/\s+/g, ' ').trim())) || null;
+    if (!resolvedInput) {
+      return { status: "ok", used: false, reason: "search_controls_not_found" };
+    }
+    resolvedInput.setAttribute('data-rpa-material-search-input', '1');
+    if (resolvedButton) resolvedButton.setAttribute('data-rpa-material-search-button', '1');
+    return {
+      status: "ok",
+      used: true,
+      inputSelector: '[data-rpa-material-search-input="1"]',
+      buttonSelector: resolvedButton ? '[data-rpa-material-search-button="1"]' : null,
+      inputMeta: {
+        id: resolvedInput.id || '',
+        name: resolvedInput.name || '',
+        className: resolvedInput.className || '',
+        placeholder: resolvedInput.placeholder || ''
+      },
+      buttonMeta: resolvedButton ? {
+        text: (resolvedButton.textContent || '').replace(/\s+/g, ' ').trim(),
+        className: resolvedButton.className || ''
+      } : null
+    };
+  }, { cardSelector, confirmSelector, configuredInputSelector, configuredButtonSelector });
+}
+
+async function searchMaterialLibrary(keyword) {
+  const normalizedKeyword = String(keyword || "").trim();
+  if (!normalizedKeyword) return { status: "ok", used: false, reason: "empty_keyword" };
+  const marked = await markMaterialSearchControls();
+  if (!marked || marked.used !== true) return marked || { status: "ok", used: false, reason: "search_controls_not_found" };
+  await page.fill(marked.inputSelector, normalizedKeyword);
+  if (marked.buttonSelector) await page.click(marked.buttonSelector);
+  else await page.press(marked.inputSelector, "Enter").catch(() => {});
+  await page.waitForTimeout(1200);
+  await page.waitForLoadState("networkidle").catch(() => {});
+  return { status: "ok", used: true, keyword: normalizedKeyword, inputMeta: marked.inputMeta, buttonMeta: marked.buttonMeta };
+}
+
+async function clearMaterialSearch() {
+  const marked = await markMaterialSearchControls();
+  if (!marked || marked.used !== true) return { status: "ok", used: false, reason: "search_controls_not_found" };
+  await page.fill(marked.inputSelector, "");
+  if (marked.buttonSelector) await page.click(marked.buttonSelector);
+  else await page.press(marked.inputSelector, "Enter").catch(() => {});
+  await page.waitForTimeout(800);
+  await page.waitForLoadState("networkidle").catch(() => {});
+  return { status: "ok", used: true };
+}
+
+async function selectMaterialCardsByNames(fileNames, options = {}) {
+  const targets = Array.isArray(fileNames) ? fileNames.map(x => String(x).trim()).filter(Boolean) : [];
+  if (targets.length === 0) throw new Error("fileNames is required");
+  const imageSel = getImageSelectors();
+  const cardSelector = imageSel.materialCard || "li.box_main_right_img";
+  const nameSelector = imageSel.materialCardName || ".box_name";
+  const maxPages = Number(imageSel.materialMaxPages || 80);
+  const existingUrls = new Set((options.existingUrls || []).map(normalizeMaterialUrl).filter(Boolean));
+  const skipExistingUrls = options.skipExistingUrls === true;
+  const shouldClick = options.select !== false;
+  const suppressMissingError = options.suppressMissingError === true;
+  const searchKeyword = String(options.searchText || (targets.length === 1 ? targets[0] : "")).trim();
+  let searchUsed = false;
+  let searchFallback = false;
+
+  async function scanPages() {
+    const picked = [];
+    const duplicates = [];
+    const alreadyPresent = [];
+    const seenByName = new Set();
+
+    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
+      const scan = await page.evaluate(({ cardSelector, nameSelector }) => {
+        function visible(el) {
+          if (!el) return false;
+          const r = el.getBoundingClientRect();
+          const s = getComputedStyle(el);
+          return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden";
+        }
+        const cards = Array.from(document.querySelectorAll(cardSelector)).filter(visible);
+        const info = cards.map((el, index) => ({
+          index,
+          id: el.id || "",
+          imgUrl: el.getAttribute("img_url") || "",
+          name: ((el.querySelector(nameSelector)?.textContent) || el.textContent || "").replace(/\s+/g, " ").trim(),
+          className: el.className || ""
+        }));
+        return { info, pageText: (document.querySelector('.box_pages')?.textContent || '').replace(/\s+/g, ' ').trim() };
+      }, { cardSelector, nameSelector });
+
+      for (const target of targets) {
+        if (seenByName.has(target)) continue;
+        const matches = scan.info.filter(card => card.name === target);
+        if (matches.length > 1) {
+          duplicates.push({ target, pageNum, matches });
+          continue;
+        }
+        if (matches.length === 1) {
+          const matched = matches[0];
+          const normalizedUrl = normalizeMaterialUrl(matched.imgUrl);
+          if (skipExistingUrls && existingUrls.has(normalizedUrl)) {
+            alreadyPresent.push({ ...matched, pageNum, normalizedUrl });
+            seenByName.add(target);
+            continue;
+          }
+          if (shouldClick) {
+            const targetIndex = matched.index;
+            await page.evaluate(({ cardSelector, targetIndex }) => {
+              function visible(el) {
+                if (!el) return false;
+                const r = el.getBoundingClientRect();
+                const s = getComputedStyle(el);
+                return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
+              }
+              const cards = Array.from(document.querySelectorAll(cardSelector)).filter(visible);
+              if (!cards[targetIndex]) throw new Error('Target card index not found on current page');
+              cards[targetIndex].click();
+            }, { cardSelector, targetIndex });
+          }
+          picked.push({ ...matched, pageNum, normalizedUrl });
+          seenByName.add(target);
+        }
+      }
+
+      const remaining = targets.filter(name => !seenByName.has(name));
+      if (remaining.length === 0) break;
+      const nextPage = pageNum + 1;
+      const pageChanged = await page.evaluate((nextCode) => {
+        const btn = Array.from(document.querySelectorAll('.box_pages .box_btn')).find(el => (el.getAttribute('code') || '') === String(nextCode));
+        if (!btn) return false;
+        btn.click();
+        return true;
+      }, nextPage);
+      if (!pageChanged) break;
+      await page.waitForTimeout(1200);
+      await page.waitForLoadState('networkidle').catch(() => {});
+    }
+
+    const missing = targets.filter(name => !seenByName.has(name));
+    if (duplicates.length > 0) {
+      return { status: "error", message: "Duplicate material names found", picked, missing, duplicates, alreadyPresent };
+    }
+    if (missing.length > 0 && !suppressMissingError) {
+      return { status: "error", message: "Material names not found", picked, missing, duplicates, alreadyPresent };
+    }
+    return { status: "ok", picked, missing, duplicates, alreadyPresent };
+  }
+
+  if (searchKeyword && options.searchFirst !== false) {
+    const searchResult = await searchMaterialLibrary(searchKeyword).catch(err => ({ status: "error", used: false, message: err.message }));
+    if (searchResult && searchResult.used) searchUsed = true;
+  }
+
+  let result = await scanPages();
+  if (searchUsed && result.status !== "ok" && (result.missing || []).length > 0) {
+    await clearMaterialSearch().catch(() => {});
+    searchFallback = true;
+    result = await scanPages();
+  }
+
+  return { ...result, searchUsed, searchFallback, searchKeyword: searchKeyword || null };
+}
+
+async function confirmImageModal() {
+  const imageSel = getImageSelectors();
+  const confirmSelector = imageSel.modalConfirmButton || "span.btn.btn-primary.save";
+  const btn = await page.$(confirmSelector);
+  if (!btn) throw new Error("Image modal confirm button not found");
+  await btn.click();
+  await page.waitForTimeout(1500);
+  await page.waitForLoadState("networkidle").catch(() => {});
+  return { status: "ok" };
+}
+
+async function cancelImageModal() {
+  const imageSel = getImageSelectors();
+  const cancelSelector = imageSel.modalCancelButton || "span.btn.btn-default.cancel";
+  const btn = await page.$(cancelSelector);
+  if (!btn) throw new Error("Image modal cancel button not found");
+  await btn.click();
+  await page.waitForTimeout(1000);
+  await page.waitForLoadState("networkidle").catch(() => {});
+  return { status: "ok" };
+}
+
+function normalizeStatusText(text) {
+  return String(text || "").replace(/\s+/g, " ").trim();
+}
+
+function isSubmitSuccessText(text) {
+  const normalized = normalizeStatusText(text);
+  if (!normalized) return false;
+  if (/澶辫触|閿欒|寮傚父|fail|error/i.test(normalized)) return false;
+  return /淇濆瓨鎴愬姛|鎿嶄綔鎴愬姛|鎻愪氦鎴愬姛|淇敼鎴愬姛|鏇存柊鎴愬姛|缂栬緫鎴愬姛|success/i.test(normalized);
+}
+
+function isSubmitFailureText(text) {
+  return /澶辫触|閿欒|寮傚父|fail(?:ed|ure)?|error/i.test(normalizeStatusText(text));
+}
+
+const SENSITIVE_PREVIEW_KEYS = new Set([
+  "password", "passwd", "pwd", "token", "accesstoken", "refreshtoken",
+  "authorization", "cookie", "setcookie", "csrf", "secret", "apikey",
+  "session", "sessionid", "clientsecret", "authtoken",
+]);
+
+function normalizeSensitivePreviewKey(key) {
+  return String(key || "").toLowerCase().replace(/[^a-z0-9]/g, "");
+}
+
+function isSensitivePreviewKey(key) {
+  return SENSITIVE_PREVIEW_KEYS.has(normalizeSensitivePreviewKey(key));
+}
+
+function redactPreview(value) {
+  let text;
+  try {
+    const parsed = typeof value === "string" ? JSON.parse(value) : value;
+    let nodes = 0;
+    function redactJson(current, depth) {
+      nodes++;
+      if (nodes > 200 || depth > 8) return "[TRUNCATED]";
+      if (Array.isArray(current)) return current.map(item => redactJson(item, depth + 1));
+      if (!current || typeof current !== "object") return current;
+      return Object.fromEntries(Object.entries(current).map(([key, item]) => [
+        key,
+        isSensitivePreviewKey(key) ? "[REDACTED]" : redactJson(item, depth + 1),
+      ]));
+    }
+    const serialized = JSON.stringify(redactJson(parsed, 0));
+    text = serialized === undefined ? String(value) : serialized;
+  } catch {
+    text = String(value === undefined ? "" : value);
+  }
+  text = text.replace(/https?:\/\/[^\s"'<>]+/gi, match => {
+    try {
+      const url = new URL(match);
+      for (const key of [...url.searchParams.keys()]) {
+        if (isSensitivePreviewKey(key)) url.searchParams.set(key, "[REDACTED]");
+      }
+      return url.toString();
+    } catch {
+      return match;
+    }
+  });
+  text = text
+    .replace(/\bBearer\s+[^\s,;"']+/gi, "Bearer [REDACTED]")
+    .replace(/\b(Authorization|Cookie|Set-Cookie)\s*:\s*[^\r\n]+/gi, "$1: [REDACTED]")
+    .replace(/\b([A-Za-z][A-Za-z0-9_-]*)\s*([=:])\s*([^\s&;,]+)/g, (match, key, separator) =>
+      isSensitivePreviewKey(key) ? key + separator + "[REDACTED]" : match);
+  return normalizeStatusText(text).substring(0, 500);
+}
+
+function submitBodyPreview(bodyText) {
+  return redactPreview(bodyText);
+}
+
+function inspectSubmitJson(root) {
+  const stack = [{ value: root, depth: 0 }];
+  let nodes = 0;
+  let success = false;
+  let truncated = false;
+  while (stack.length > 0 && nodes < 200) {
+    const { value, depth } = stack.pop();
+    nodes++;
+    if (!value || typeof value !== "object") continue;
+    if (depth > 8) {
+      truncated = true;
+      continue;
+    }
+    if (Array.isArray(value)) {
+      for (const item of value) stack.push({ value: item, depth: depth + 1 });
+      continue;
+    }
+    const markerText = [value.message, value.msg, value.errmsg]
+      .filter(item => typeof item === "string").join(" ");
+    const statusMarker = value.status === undefined ? "" : String(value.status).toLowerCase();
+    const codeMarker = value.code === undefined ? "" : String(value.code).toLowerCase();
+    const explicitError = Object.prototype.hasOwnProperty.call(value, "error") && Boolean(value.error);
+    const failureCode = value.code !== undefined && !["1", "ok", "success", "succeeded"].includes(codeMarker)
+      && isSubmitFailureText(markerText);
+    if (value.success === false || value.ok === false || explicitError
+      || /^(error|fail|failed|failure)$/.test(statusMarker) || statusMarker === "0"
+      || failureCode || isSubmitFailureText(markerText)) return { failure: true, success: false };
+    if (value.success === true || value.ok === true || /^(ok|success|succeeded)$/.test(statusMarker)
+      || statusMarker === "1" || codeMarker === "1" || isSubmitSuccessText(markerText)) success = true;
+    for (const item of Object.values(value)) {
+      if (item && typeof item === "object") stack.push({ value: item, depth: depth + 1 });
+    }
+  }
+  if (stack.length > 0) truncated = true;
+  return { failure: false, success, truncated };
+}
+
+function matchesSubmitResponseEvidence(evidence, options = {}) {
+  if (String(evidence && evidence.method || "").toUpperCase() !== "POST") return false;
+  try {
+    const responseUrl = new URL(String(evidence && evidence.url || ""));
+    const pageUrl = new URL(String(options.pageUrl || ""));
+    if (responseUrl.origin !== pageUrl.origin || responseUrl.pathname !== pageUrl.pathname) return false;
+    if (responseUrl.searchParams.get("r") !== "goods.edit") return false;
+    if (options.expectedProductId !== undefined && options.expectedProductId !== null) {
+      return responseUrl.searchParams.get("id") === String(options.expectedProductId);
+    }
+    return true;
+  } catch {
+    return false;
+  }
+}
+
+function classifySubmitResponseEvidence(evidence, options = {}) {
+  const bodyPreview = submitBodyPreview(evidence && evidence.bodyText);
+  const base = {
+    url: redactPreview(String(evidence && evidence.url || "")),
+    method: String(evidence && evidence.method || "").toUpperCase(),
+    httpStatus: Number(evidence && evidence.httpStatus || 0),
+    contentType: String(evidence && evidence.contentType || "").toLowerCase(),
+    bodyPreview,
+  };
+  if (!matchesSubmitResponseEvidence(evidence, options)) return { status: "ignored", ...base };
+  if (base.httpStatus >= 400 && base.httpStatus <= 599) return { status: "error", detail: "http_status_" + base.httpStatus, ...base };
+  if (base.httpStatus >= 300 && base.httpStatus <= 399) return { status: "unknown", detail: "http_redirect_" + base.httpStatus, ...base };
+  if (base.httpStatus < 200 || base.httpStatus >= 600) return { status: "unknown", detail: "unfamiliar_http_status_" + base.httpStatus, ...base };
+  if (base.httpStatus === 204 || !bodyPreview) return { status: "unknown", detail: "empty_response", ...base };
+
+  if (/^(application|text)\/[\w.+-]*json\b/.test(base.contentType)) {
+    let parsed;
+    try {
+      parsed = JSON.parse(String(evidence.bodyText));
+    } catch {
+      return { status: "unknown", detail: "malformed_json", ...base };
+    }
+    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { status: "unknown", detail: "unfamiliar_json", ...base };
+    const inspection = inspectSubmitJson(parsed);
+    if (inspection.failure) return { status: "error", detail: "explicit_json_failure", ...base };
+    if (inspection.truncated) return { status: "unknown", detail: "inspection_truncated", ...base };
+    return inspection.success
+      ? { status: "ok", detail: "explicit_json_success", ...base }
+      : { status: "unknown", detail: "unfamiliar_json", ...base };
+  }
+
+  if (/^text\/plain\b/.test(base.contentType)) {
+    if (isSubmitFailureText(bodyPreview)) return { status: "error", detail: "explicit_text_failure", ...base };
+    if (isSubmitSuccessText(bodyPreview)) return { status: "ok", detail: "explicit_text_success", ...base };
+  }
+  return { status: "unknown", detail: "unfamiliar_response", ...base };
+}
+
+function createSubmitResponseObserver(targetPage, options = {}) {
+  const timers = options.timers || { setTimeout, clearTimeout };
+  const successGraceMs = Math.max(1, Number(options.successGraceMs || 350));
+  const bodyReadGraceMs = Math.max(1, Number(options.bodyReadGraceMs || 500));
+  let disposed = false;
+  let settled = false;
+  let armed = options.startArmed !== false;
+  let armGeneration = armed ? 1 : 0;
+  let deadlineReached = false;
+  const inFlightBodyReads = new Set();
+  let deadlineHandle = null;
+  let successHandle = null;
+  let bodyReadGraceHandle = null;
+  let bestResult = null;
+  let capturedRequest = null;
+  let resolveResult;
+  const result = new Promise(resolve => { resolveResult = resolve; });
+
+  function arm() {
+    if (disposed || settled) return false;
+    if (!armed) {
+      armed = true;
+      armGeneration++;
+    }
+    return true;
+  }
+
+  function disarm() {
+    if (disposed) return;
+    if (armed) armGeneration++;
+    armed = false;
+    bestResult = null;
+    capturedRequest = null;
+    inFlightBodyReads.clear();
+    if (successHandle) timers.clearTimeout(successHandle);
+    if (bodyReadGraceHandle) timers.clearTimeout(bodyReadGraceHandle);
+    successHandle = null;
+    bodyReadGraceHandle = null;
+  }
+
+  function dispose() {
+    if (disposed) return;
+    disarm();
+    disposed = true;
+    if (deadlineHandle) timers.clearTimeout(deadlineHandle);
+    if (successHandle) timers.clearTimeout(successHandle);
+    if (bodyReadGraceHandle) timers.clearTimeout(bodyReadGraceHandle);
+    targetPage.off("response", onResponse);
+  }
+
+  function settle(value) {
+    if (settled) return;
+    settled = true;
+    dispose();
+    resolveResult(value);
+  }
+
+  function settleAfterBodyReadGrace() {
+    if (bodyReadGraceHandle || settled) return;
+    bodyReadGraceHandle = timers.setTimeout(() => {
+      bodyReadGraceHandle = null;
+      if (inFlightBodyReads.size > 0) {
+        settle({ status: "unknown", detail: "body_read_timeout", bodyPreview: "" });
+        return;
+      }
+      settle(bestResult || { status: "unknown", detail: "body_read_timeout", bodyPreview: "" });
+    }, bodyReadGraceMs);
+  }
+
+  function scheduleSuccessSettlement() {
+    if (successHandle || settled) return;
+    successHandle = timers.setTimeout(() => {
+      successHandle = null;
+      if (inFlightBodyReads.size > 0) {
+        settleAfterBodyReadGrace();
+        return;
+      }
+      settle(bestResult);
+    }, successGraceMs);
+  }
+
+  function recordClassified(classified) {
+    if (classified.status === "error") {
+      settle(classified);
+      return;
+    }
+    if (classified.status === "ok" || !bestResult) bestResult = classified;
+    if (deadlineReached && inFlightBodyReads.size === 0) {
+      settle(bestResult || classified);
+      return;
+    }
+    if (classified.status === "ok") scheduleSuccessSettlement();
+  }
+
+  async function onResponse(response) {
+    if (!armed || disposed || settled) return;
+    const request = response.request();
+    const evidence = {
+      url: response.url(),
+      method: request.method(),
+      httpStatus: response.status(),
+      contentType: String(response.headers()["content-type"] || ""),
+      bodyText: "",
+    };
+    if (!matchesSubmitResponseEvidence(evidence, options)) return;
+    if (!capturedRequest) capturedRequest = request;
+    else if (request !== capturedRequest) return;
+    const responseArmGeneration = armGeneration;
+    if (evidence.httpStatus < 200 || evidence.httpStatus >= 300 || evidence.httpStatus === 204) {
+      if (armed && armGeneration === responseArmGeneration) recordClassified(classifySubmitResponseEvidence(evidence, options));
+      return;
+    }
+    const bodyReadToken = {};
+    inFlightBodyReads.add(bodyReadToken);
+    let bodyReadSucceeded = false;
+    try {
+      evidence.bodyText = await response.text();
+      bodyReadSucceeded = true;
+    } catch (err) {
+      if (armed && armGeneration === responseArmGeneration) {
+        recordClassified({
+          status: "unknown",
+          detail: "body_read_failed: " + String(err && err.message || err || "unknown"),
+          ...evidence,
+          bodyPreview: "",
+        });
+      }
+    } finally {
+      inFlightBodyReads.delete(bodyReadToken);
+    }
+    if (bodyReadSucceeded && armed && armGeneration === responseArmGeneration) recordClassified(classifySubmitResponseEvidence(evidence, options));
+    if (deadlineReached && inFlightBodyReads.size === 0 && !settled) settle(bestResult || { status: "unknown", detail: "response_timeout", bodyPreview: "" });
+  }
+
+  targetPage.on("response", onResponse);
+  deadlineHandle = timers.setTimeout(() => {
+    deadlineReached = true;
+    if (inFlightBodyReads.size > 0) settleAfterBodyReadGrace();
+    else settle(bestResult || { status: "unknown", detail: "response_timeout", bodyPreview: "" });
+  }, Math.max(1, Number(options.timeoutMs || 15000)));
+  return { result, arm, disarm, dispose };
+}
+
+function classifySubmitClickError(error) {
+  const message = String(error && error.message || error || "submit click failed");
+  if (/click.*Timeout .*exceeded|Timeout .*click|waiting for click.*exceeded/i.test(message)) {
+    return { disposition: "unknown", status: "unknown", submitted: null, sideEffectPossible: true, retrySafe: false };
+  }
+  if (/intercepts pointer events|element is not enabled/i.test(message)) return { disposition: "retry" };
+  return { disposition: "error", status: "error", message };
+}
+
+function resolveImmediateSubmitOutcome({ responseResult, redirectDetail = "", toastDetail = "" } = {}) {
+  const response = responseResult || { status: "unknown", detail: "no_matching_ajax_response" };
+  if (response.status === "error") {
+    return { status: "error", submitted: false, detail: response.detail || "explicit_ajax_error", response };
+  }
+  if (response.status === "ok") {
+    return { status: "ok", submitted: true, detail: response.detail || "explicit_ajax_success", response };
+  }
+  const detail = [response.detail, redirectDetail, toastDetail].filter(Boolean).join("; ") || "no_decisive_submit_signal";
+  return {
+    status: "unknown",
+    submitted: null,
+    detail,
+    verified: "check_with_readback",
+    sideEffectPossible: true,
+    retrySafe: false,
+    response,
+  };
+}
+
+async function dispatchSubmitClick(element, observer) {
+  try {
+    await element.click({ trial: true });
+  } catch (err) {
+    if (err && typeof err === "object") err.submitClickPhase = "trial";
+    throw err;
+  }
+  observer.arm();
+  try {
+    await element.click({ force: true });
+  } catch (err) {
+    if (err && typeof err === "object") err.submitClickPhase = "dispatch";
+    throw err;
+  }
+}
+
+function getSubmitToastSelectors(configuredSelector) {
+  return [...new Set([
+    configuredSelector,
+    ".layui-layer-dialog",
+    ".layui-layer-msg",
+    ".alert-success",
+    ".alert-info",
+    ".toast",
+    ".success",
+    ".success_tip",
+    ".message",
+    ".notification",
+    "#msg",
+    ".layui-m-layer",
+  ].filter(sel => typeof sel === "string" && sel.trim()))];
+}
+
+function excludeBaselineToastCandidates(candidates, baseline) {
+  const baselineKeys = new Set((baseline || []).map(item => item.selector + "\u0000" + item.text));
+  return (candidates || []).filter(item => !baselineKeys.has(item.selector + "\u0000" + item.text));
+}
+
+async function readVisibleSubmitToastCandidates(selectors) {
+  return page.evaluate((sels) => {
+    function visible(el) {
+      if (!el) return false;
+      const r = el.getBoundingClientRect();
+      const s = getComputedStyle(el);
+      return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden";
+    }
+    const rows = [];
+    for (const sel of sels) {
+      const nodes = Array.from(document.querySelectorAll(sel)).filter(visible);
+      for (const node of nodes) {
+        const text = (node.textContent || "").replace(/\s+/g, " ").trim();
+        if (text) rows.push({ selector: sel, text: text.substring(0, 200) });
+      }
+    }
+    return rows;
+  }, selectors).catch(() => []);
+}
+
+async function dismissBlockingDialogs() {
+  const dismissed = await page.evaluate(() => {
+    function visible(el) {
+      if (!el) return false;
+      const r = el.getBoundingClientRect();
+      const s = getComputedStyle(el);
+      return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden";
+    }
+    const dialogSelector = ".jconfirm, .layui-layer-dialog, .layui-layer-confirm, .modal.show, .modal.in";
+    const actionText = /^(纭畾|纭|鐭ラ亾浜唡鍏抽棴|濂絴鏄瘄OK)$/i;
+    const successText = /淇濆瓨鎴愬姛|鎿嶄綔鎴愬姛|鎻愪氦鎴愬姛|success/i;
+    const failureText = /澶辫触|閿欒|寮傚父/;
+    const dialogs = Array.from(document.querySelectorAll(dialogSelector)).filter(visible);
+    const actions = [];
+    for (const dialog of dialogs) {
+      const text = (dialog.textContent || "").replace(/\s+/g, " ").trim().substring(0, 120);
+      if (text && successText.test(text) && !failureText.test(text)) {
+        continue;
+      }
+      const closeBtn = Array.from(dialog.querySelectorAll(".jconfirm-closeIcon, .layui-layer-close, .close, [data-dismiss='modal'], [aria-label='Close']")).find(visible) || null;
+      if (closeBtn) {
+        closeBtn.click();
+        actions.push({ type: "close", text });
+        continue;
+      }
+      const confirmBtn = Array.from(dialog.querySelectorAll("button, a, span.btn, input[type='button'], input[type='submit']")).find(node => {
+        if (!visible(node)) return false;
+        const label = ((node.textContent || node.value || "")).replace(/\s+/g, " ").trim();
+        return actionText.test(label);
+      }) || null;
+      if (confirmBtn) {
+        confirmBtn.click();
+        actions.push({ type: "confirm", text });
+      }
+    }
+    return { count: actions.length, actions };
+  });
+  if (dismissed.count > 0) {
+    await page.waitForTimeout(1000);
+    await page.waitForLoadState("networkidle").catch(() => {});
+  }
+  return dismissed;
+}
+
+async function detectSubmitSuccessToast(configuredSelector, baseline = [], overallDeadline = Infinity) {
+  const selectors = getSubmitToastSelectors(configuredSelector);
+  const deadline = Math.min(Date.now() + 4000, overallDeadline);
+  let lastNonSuccess = null;
+  while (Date.now() < deadline) {
+    const hits = excludeBaselineToastCandidates(await readVisibleSubmitToastCandidates(selectors), baseline);
+    for (const hit of hits) {
+      if (isSubmitSuccessText(hit.text)) {
+        return {
+          success: true,
+          detail: "toast(" + hit.selector + "): " + hit.text.substring(0, 40),
+          selector: hit.selector,
+          text: hit.text,
+        };
+      }
+      if (!lastNonSuccess) lastNonSuccess = hit;
+    }
+    await page.waitForTimeout(Math.min(250, Math.max(1, deadline - Date.now())));
+  }
+  return {
+    success: false,
+    detail: lastNonSuccess ? "non_success_signal(" + lastNonSuccess.selector + "): " + lastNonSuccess.text.substring(0, 40) : "",
+    selector: lastNonSuccess ? lastNonSuccess.selector : "",
+    text: lastNonSuccess ? lastNonSuccess.text : "",
+  };
+}
+
+function normalizeMaterialUrl(value) {
+  const raw = String(value || "").trim();
+  if (!raw) return "";
+  if (/^https?:\/\//i.test(raw)) return raw;
+  if (raw.startsWith("/")) return new URL(raw, config.saas.baseUrl).toString();
+  return new URL(raw, "https://zloss.xinyongzu.cn/").toString();
+}
+
+async function ensureImagePage(productId, allowCurrentPage, expectedProductId) {
+  const targetProductId = expectedProductId || productId;
+  if (allowCurrentPage) {
+    return validateProductPageAfterNavigation(page.url(), targetProductId, config.saas.productDetailUrl, true);
+  }
+  const initialNavigation = await actionNavigate(productId);
+  if (initialNavigation.status !== "ok") return initialNavigation;
+  await ensureLogin();
+  if (page.url().includes("c=site") && !page.url().includes("goods.edit")) {
+    const loginNavigation = await actionNavigate(productId);
+    if (loginNavigation.status !== "ok") return loginNavigation;
+  }
+  await page.waitForTimeout(1000);
+  return validateProductPageAfterNavigation(page.url(), targetProductId, config.saas.productDetailUrl, false);
+}
+
+function getVASSelectors() {
+  return (config.selectors && config.selectors.vas) || {};
+}
+
+async function ensureVASPage(productId, allowCurrentPage, expectedProductId) {
+  return ensureImagePage(productId, allowCurrentPage, expectedProductId);
+}
+
+async function readVASStateFromPage() {
+  const selectors = getVASSelectors();
+  return await page.evaluate((sel) => {
+    const boolValue = value => String(value ?? "") === "1" || value === true;
+    const readNamed = (root, names) => {
+      for (const name of names) {
+        const input = root.querySelector(`input[name$="[${name}]"]`);
+        if (input) return input.value || "";
+      }
+      return "";
+    };
+    const enabledRadios = Array.from(document.querySelectorAll(sel.enabledRadio));
+    const platformCheckboxes = Array.from(document.querySelectorAll(sel.platformCheckbox));
+    const serviceList = document.querySelector(sel.list);
+    const missing = [];
+    if (enabledRadios.length === 0) missing.push("enabledRadio");
+    if (platformCheckboxes.length === 0) missing.push("platformCheckbox");
+    if (!serviceList) missing.push("list");
+    if (missing.length > 0) return { ok: false, missing };
+    const enabledNode = enabledRadios.find(node => node.checked);
+    if (!enabledNode) return { ok: false, missing: ["enabledRadio.checked"] };
+    const platforms = platformCheckboxes.filter(node => node.checked).map(node => node.value);
+    const services = Array.from(document.querySelectorAll(sel.item)).map(item => ({
+      id: readNamed(item, ["id"]),
+      serviceName: readNamed(item, ["service_name"]),
+      serviceMoney: readNamed(item, ["service_money"]),
+      defaultSelected: boolValue(readNamed(item, ["defaultSelected"])),
+      isForce: boolValue(readNamed(item, ["is_force"])),
+      isPopup: boolValue(readNamed(item, ["is_popup"])),
+      metadata: {
+        describe: readNamed(item, ["describe"]),
+        disclaimer: readNamed(item, ["disclaimer"]),
+        protectionScope: readNamed(item, ["protection_scope"]),
+        claimProcess: readNamed(item, ["claim_process"]),
+        specialInstruction: readNamed(item, ["special_intruction", "special_instruction"]),
+        picDesc: readNamed(item, ["pic_desc"]),
+      },
+    }));
+    return { ok: true, enabled: String(enabledNode.value) === "1", platforms, services };
+  }, selectors);
+}
+
+async function actionVASRead(productId, allowCurrentPage, expectedProductId) {
+  const prep = await ensureVASPage(productId, allowCurrentPage, expectedProductId);
+  if (prep.status !== "ok") return prep;
+  const state = await readVASStateFromPage();
+  if (!state || state.ok !== true) {
+    return { status: "error", productId: prep.productId, currentPage: prep.currentPage, message: "VAS selectors missing or no enabled radio is checked", missing: state?.missing || [] };
+  }
+  return { status: "ok", productId: prep.productId, currentPage: prep.currentPage, enabled: state.enabled, platforms: state.platforms, services: state.services };
+}
+
+function normalizeVASCatalogItem(item) {
+  return {
+    id: String(item.id ?? ""),
+    serviceName: String(item.serviceName ?? item.service_name ?? item.name ?? ""),
+    serviceMoney: String(item.serviceMoney ?? item.service_money ?? item.money ?? ""),
+    metadata: {
+      describe: String(item.describe ?? ""),
+      disclaimer: String(item.disclaimer ?? ""),
+      protectionScope: String(item.protectionScope ?? item.protection_scope ?? ""),
+      claimProcess: String(item.claimProcess ?? item.claim_process ?? ""),
+      specialInstruction: String(item.specialInstruction ?? item.special_intruction ?? ""),
+      picDesc: String(item.picDesc ?? item.pic_desc ?? ""),
+    },
+  };
+}
+
+async function actionVASCatalogRead(productId, keyword, ids, allowCurrentPage, expectedProductId) {
+  const prep = await ensureVASPage(productId, allowCurrentPage, expectedProductId);
+  if (prep.status !== "ok") return prep;
+  const endpoint = config.vas && config.vas.catalogEndpoint;
+  if (!endpoint) return { status: "error", message: "config.vas.catalogEndpoint is not configured" };
+  const response = await page.evaluate(async ({ endpoint, keyword, goodsId }) => {
+    const body = new URLSearchParams();
+    body.set("keyword", keyword || "");
+    body.set("goodsId", goodsId || "");
+    const res = await fetch(endpoint, {
+      method: "POST",
+      credentials: "same-origin",
+      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" },
+      body: body.toString(),
+    });
+    const text = await res.text();
+    if (!res.ok) return { ok: false, status: res.status, text: text.slice(0, 1000) };
+    try { return { ok: true, json: JSON.parse(text) }; }
+    catch { return { ok: false, status: res.status, text: text.slice(0, 1000) }; }
+  }, { endpoint, keyword: String(keyword || ""), goodsId: String(prep.productId || productId || "") });
+  if (!response.ok) return { status: "error", message: "VAS catalog request failed", response };
+  const rawList = response.json?.data?.list || response.json?.list || response.json?.data || [];
+  const requestedIds = new Set((Array.isArray(ids) ? ids : []).map(value => String(value)));
+  const catalog = (Array.isArray(rawList) ? rawList : []).map(normalizeVASCatalogItem).filter(item => item.id && (requestedIds.size === 0 || requestedIds.has(item.id)));
+  return { status: "ok", productId: prep.productId, currentPage: prep.currentPage, keyword: String(keyword || ""), ids: [...requestedIds], catalog };
+}
+
+async function actionVASApply(productId, expectedVAS, allowCurrentPage, expectedProductId) {
+  const prep = await ensureVASPage(productId, allowCurrentPage, expectedProductId);
+  if (prep.status !== "ok") return prep;
+  if (!expectedVAS || typeof expectedVAS !== "object") return { status: "error", message: "expectedVAS full target state is required" };
+  const targetValidation = validateVASTargetState(expectedVAS);
+  if (!targetValidation.ok) {
+    return { status: "error", productId: prep.productId, message: "Invalid expectedVAS target: " + targetValidation.errors.join("; "), validation: targetValidation };
+  }
+  const selectors = getVASSelectors();
+  const target = targetValidation.target;
+  const applyResult = await page.evaluate(({ sel, target }) => {
+    const radios = Array.from(document.querySelectorAll(sel.enabledRadio));
+    const targetRadio = radios.find(node => String(node.value) === (target.enabled ? "1" : "0"));
+    if (!targetRadio) return { ok: false, message: "VAS enabled radio not found" };
+    if (!targetRadio.checked) targetRadio.click();
+
+    const platformSet = new Set(target.platforms);
+    for (const checkbox of document.querySelectorAll(sel.platformCheckbox)) {
+      const shouldCheck = platformSet.has(String(checkbox.value));
+      if (checkbox.checked !== shouldCheck) checkbox.click();
+    }
+
+    if (typeof window.addGoodsIncrement !== "function") return { ok: false, message: "window.addGoodsIncrement is not available" };
+    const services = target.services.map(service => ({
+      id: String(service.id),
+      name: String(service.serviceName || ""),
+      money: String(service.serviceMoney || ""),
+      describe: String(service.metadata?.describe || ""),
+      disclaimer: String(service.metadata?.disclaimer || ""),
+      protection_scope: String(service.metadata?.protectionScope || ""),
+      claim_process: String(service.metadata?.claimProcess || ""),
+      special_intruction: String(service.metadata?.specialInstruction || ""),
+      pic_desc: String(service.metadata?.picDesc || ""),
+    }));
+    window.addGoodsIncrement(services);
+
+    const boxes = Array.from(document.querySelectorAll(sel.item));
+    const readId = box => box.querySelector('input[name$="[id]"]')?.value || "";
+    const setOption = (box, selector, desired) => {
+      if (!selector) return "selector_missing";
+      const checkbox = box.querySelector(selector);
+      if (!checkbox) return "missing";
+      if (checkbox.checked !== desired) checkbox.click();
+      return checkbox.checked === desired ? "ok" : "mismatch";
+    };
+    const optionResults = [];
+    for (const service of target.services) {
+      const box = boxes.find(item => readId(item) === String(service.id));
+      if (!box) { optionResults.push({ id: service.id, option: "item", status: "missing" }); continue; }
+      optionResults.push({ id: service.id, option: "defaultSelected", status: setOption(box, sel.defaultCheckbox, service.defaultSelected === true) });
+    }
+    for (const service of target.services) {
+      const box = boxes.find(item => readId(item) === String(service.id));
+      if (box) optionResults.push({ id: service.id, option: "isPopup", status: setOption(box, sel.popupCheckbox, service.isPopup === true) });
+    }
+    for (const service of target.services) {
+      const box = boxes.find(item => readId(item) === String(service.id));
+      if (box) optionResults.push({ id: service.id, option: "isForce", status: setOption(box, sel.forceCheckbox, service.isForce === true) });
+    }
+    const optionFailures = optionResults.filter(item => item.status !== "ok");
+    return {
+      ok: optionFailures.length === 0,
+      message: optionFailures.length > 0 ? "VAS option control missing or did not reach target state" : "",
+      optionResults,
+      optionFailures,
+    };
+  }, { sel: selectors, target });
+  if (!applyResult.ok) return { status: "error", productId: prep.productId, message: applyResult.message, applyResult };
+  await page.waitForTimeout(300);
+  const readback = await readVASStateFromPage();
+  if (!readback || readback.ok !== true) {
+    return {
+      status: "error",
+      productId: prep.productId,
+      currentPage: prep.currentPage,
+      message: "VAS selectors missing or no enabled radio is checked after apply",
+      missing: readback?.missing || [],
+      readback,
+      optionResults: applyResult.optionResults,
+    };
+  }
+  const compare = compareVASState(readback, target);
+  return {
+    status: compare.mismatched === 0 ? "ok" : "partial",
+    productId: prep.productId,
+    currentPage: prep.currentPage,
+    expectedVAS: target,
+    readback,
+    compare,
+    optionResults: applyResult.optionResults,
+  };
+}
+
+async function actionVASVerify(productId, expectedVAS, allowCurrentPage, expectedProductId) {
+  const validation = validateVASTargetState(expectedVAS);
+  if (!validation.ok) {
+    return {
+      status: "error",
+      message: "Invalid expectedVAS target: " + validation.errors.join("; "),
+      validation,
+    };
+  }
+  const current = await actionVASRead(productId, allowCurrentPage, expectedProductId);
+  if (!current || current.status !== "ok") return { status: "error", message: current?.message || "vas-read failed", readback: current || null };
+  const compare = compareVASState(current, validation.target);
+  return {
+    status: compare.mismatched === 0 ? "ok" : "mismatch",
+    productId: current.productId,
+    currentPage: current.currentPage,
+    expectedVAS: validation.target,
+    readback: { enabled: current.enabled, platforms: current.platforms, services: current.services },
+    verifyResult: compare,
+  };
+}
+
+async function actionDiscardCurrentForm(expectedProductId) {
+  if (!expectedProductId) return { status: "error", message: "discard-current-form requires expectedProductId" };
+  const currentCheck = assertCurrentProduct(expectedProductId);
+  if (!currentCheck.ok) return { status: "error", message: "Current page product mismatch", ...currentCheck };
+  const initialNavigation = await actionNavigate(expectedProductId);
+  if (initialNavigation.status !== "ok") return initialNavigation;
+  await ensureLogin();
+  if (page.url().includes("c=site") && !page.url().includes("goods.edit")) {
+    const loginNavigation = await actionNavigate(expectedProductId);
+    if (loginNavigation.status !== "ok") return loginNavigation;
+  }
+  await page.waitForLoadState("networkidle").catch(() => {});
+  await page.waitForTimeout(500);
+  const restoredProductId = getCurrentProductIdFromUrl();
+  if (String(restoredProductId || "") !== String(expectedProductId)) {
+    return { status: "error", message: "Discard navigation restored wrong product", expectedProductId: String(expectedProductId), productId: restoredProductId, url: page.url() };
+  }
+  return { status: "ok", productId: restoredProductId, url: page.url(), discarded: true };
+}
+
+async function actionImageRead(productId, allowCurrentPage, expectedProductId) {
+  const prep = await ensureImagePage(productId, allowCurrentPage, expectedProductId);
+  if (prep.status !== "ok") return prep;
+  const thumbs = await readImageSectionState("thumbs");
+  const white = await readImageSectionState("white");
+  return {
+    status: "ok",
+    productId: prep.productId,
+    currentPage: prep.currentPage,
+    thumbs,
+    white,
+    thumbnail: thumbs.values[0] || "",
+  };
+}
+
+function compareImageState(actual, expected = {}) {
+  const checks = [];
+  const expectedThumbs = Array.isArray(expected.thumbs) ? expected.thumbs.map(normalizeMaterialUrl).filter(Boolean) : [];
+  const actualThumbs = actual && actual.thumbs && Array.isArray(actual.thumbs.values) ? actual.thumbs.values.map(normalizeMaterialUrl) : [];
+  if (expectedThumbs.length > 0) {
+    const thumbsMatch = JSON.stringify(actualThumbs) === JSON.stringify(expectedThumbs);
+    checks.push({ field: "thumbs", expected: expectedThumbs, actual: actualThumbs, match: thumbsMatch });
+  }
+  if (expected.thumbnail !== undefined && expected.thumbnail !== null && String(expected.thumbnail).trim()) {
+    const expectedThumbnail = normalizeMaterialUrl(expected.thumbnail);
+    const actualThumbnail = normalizeMaterialUrl(actual && actual.thumbnail);
+    checks.push({ field: "thumbnail", expected: expectedThumbnail, actual: actualThumbnail, match: actualThumbnail === expectedThumbnail });
+  }
+  if (expected.white !== undefined && expected.white !== null && String(expected.white).trim()) {
+    const expectedWhite = normalizeMaterialUrl(expected.white);
+    const actualWhite = normalizeMaterialUrl(actual && actual.white && actual.white.value);
+    checks.push({ field: "white", expected: expectedWhite, actual: actualWhite, match: actualWhite === expectedWhite });
+  }
+  const mismatches = checks.filter(item => !item.match);
+  return {
+    total: checks.length,
+    matched: checks.length - mismatches.length,
+    mismatched: mismatches.length,
+    checks,
+    mismatches,
+  };
+}
+
+async function actionImageVerify(productId, expected, allowCurrentPage, expectedProductId) {
+  const current = await actionImageRead(productId, allowCurrentPage, expectedProductId);
+  if (!current || current.status !== "ok") {
+    return {
+      status: "error",
+      message: current && current.message ? current.message : "image-read failed",
+      readback: current || null,
+    };
+  }
+  const compare = compareImageState(current, expected || {});
+  return {
+    status: compare.mismatched === 0 ? "ok" : "mismatch",
+    productId: current.productId,
+    currentPage: current.currentPage,
+    expected,
+    readback: current,
+    verifyResult: compare,
+  };
+}
+
+async function actionImagePick(productId, categoryName, fileNames, allowCurrentPage, expectedProductId, options = {}) {
+  const prep = await ensureImagePage(productId, allowCurrentPage, expectedProductId);
+  if (prep.status !== "ok") return prep;
+  const before = await readImageSectionState("thumbs");
+  const requested = Array.isArray(fileNames) ? fileNames.map(x => String(x).trim()).filter(Boolean) : [String(fileNames || "").trim()].filter(Boolean);
+  await openImageModal("thumbs");
+  if (categoryName) await clickImageCategory(categoryName);
+  const selection = await selectMaterialCardsByNames(requested, {
+    existingUrls: before.values,
+    skipExistingUrls: options.skipIfAlreadyPresent === true,
+    searchText: requested.length === 1 ? requested[0] : "",
+  });
+  if (selection.status !== "ok") return selection;
+  const alreadyPresent = selection.alreadyPresent || [];
+  const selected = selection.picked || [];
+  if (selected.length === 0) {
+    await cancelImageModal();
+    const afterSkip = await readImageSectionState("thumbs");
+    return {
+      status: "ok",
+      productId: prep.productId,
+      currentPage: prep.currentPage,
+      categoryName,
+      requested,
+      selected: [],
+      alreadyPresent,
+      expectedUrls: alreadyPresent.map(item => item.normalizedUrl || normalizeMaterialUrl(item.imgUrl)),
+      appended: [],
+      before,
+      after: afterSkip,
+      missingUrls: [],
+      skipped: true,
+      reason: "all_requested_images_already_present",
+      searchUsed: selection.searchUsed,
+      searchFallback: selection.searchFallback,
+      searchKeyword: selection.searchKeyword,
+    };
+  }
+  await confirmImageModal();
+  const after = await readImageSectionState("thumbs");
+  const expectedUrls = selected.map(item => normalizeMaterialUrl(item.imgUrl));
+  const appended = after.values.filter(url => !before.values.includes(url));
+  const missingUrls = expectedUrls.filter(url => !after.values.includes(url));
+  return {
+    status: missingUrls.length === 0 ? "ok" : "partial",
+    productId: prep.productId,
+    currentPage: prep.currentPage,
+    categoryName,
+    requested,
+    selected,
+    alreadyPresent,
+    expectedUrls,
+    appended,
+    before,
+    after,
+    missingUrls,
+    searchUsed: selection.searchUsed,
+    searchFallback: selection.searchFallback,
+    searchKeyword: selection.searchKeyword,
+  };
+}
+
+async function actionImageOrder(productId, orderedUrls, allowCurrentPage, expectedProductId) {
+  const prep = await ensureImagePage(productId, allowCurrentPage, expectedProductId);
+  if (prep.status !== "ok") return prep;
+  const before = await readImageSectionState("thumbs");
+  const targetOrder = Array.isArray(orderedUrls) ? orderedUrls.map(normalizeMaterialUrl).filter(Boolean) : [];
+  if (targetOrder.length === 0) return { status: "error", message: "orderedUrls is required" };
+  const beforeSet = [...before.values].sort().join("||");
+  const targetSet = [...targetOrder].sort().join("||");
+  if (beforeSet !== targetSet) {
+    return { status: "error", message: "orderedUrls must exactly match current thumbs[] set", current: before.values, orderedUrls: targetOrder };
+  }
+  const imageSel = getImageSelectors();
+  const moveResult = await page.evaluate(({ orderedUrls, multiItemSelector, inputSelector }) => {
+    const list = document.querySelector('.gimgs .multi-img-details');
+    if (!list) return { ok: false, message: 'Image list not found' };
+    const items = Array.from(list.querySelectorAll(multiItemSelector || '.multi-item'));
+    const map = new Map(items.map(item => {
+      const input = item.querySelector(inputSelector || 'input[name="thumbs[]"]');
+      return [input ? input.value : '', item];
+    }));
+    for (const url of orderedUrls) {
+      const item = map.get(url);
+      if (!item) return { ok: false, message: 'Item not found for url: ' + url };
+      list.appendChild(item);
+    }
+    return { ok: true };
+  }, { orderedUrls: targetOrder, multiItemSelector: imageSel.multiItem || '.multi-item', inputSelector: imageSel.thumbsInput || 'input[name="thumbs[]"]' });
+  if (!moveResult.ok) return { status: "error", message: moveResult.message };
+  await page.waitForTimeout(500);
+  const after = await readImageSectionState("thumbs");
+  return {
+    status: JSON.stringify(after.values) === JSON.stringify(targetOrder) ? "ok" : "partial",
+    productId: prep.productId,
+    currentPage: prep.currentPage,
+    before,
+    after,
+    targetOrder,
+    thumbnail: after.values[0] || "",
+  };
+}
+
+async function actionWhiteImageSet(productId, categoryName, fileName, allowCurrentPage, expectedProductId, options = {}) {
+  const prep = await ensureImagePage(productId, allowCurrentPage, expectedProductId);
+  if (prep.status !== "ok") return prep;
+  const before = await readImageSectionState("white");
+  const requested = String(fileName || "").trim();
+  await openImageModal("white");
+  if (categoryName) await clickImageCategory(categoryName);
+  const selection = await selectMaterialCardsByNames([requested], {
+    existingUrls: before.value ? [before.value] : [],
+    skipExistingUrls: options.skipIfWhiteImageMatched === true,
+    searchText: requested,
+  });
+  if (selection.status !== "ok") return selection;
+  if ((selection.picked || []).length === 0) {
+    await cancelImageModal();
+    const afterSkip = await readImageSectionState("white");
+    return {
+      status: "ok",
+      productId: prep.productId,
+      currentPage: prep.currentPage,
+      categoryName,
+      requested,
+      selected: null,
+      alreadyPresent: selection.alreadyPresent || [],
+      expectedUrl: before.value || "",
+      before,
+      after: afterSkip,
+      skipped: true,
+      reason: "white_image_already_matched",
+      searchUsed: selection.searchUsed,
+      searchFallback: selection.searchFallback,
+      searchKeyword: selection.searchKeyword,
+    };
+  }
+  await confirmImageModal();
+  const after = await readImageSectionState("white");
+  const expectedUrl = normalizeMaterialUrl(selection.picked[0].imgUrl);
+  return {
+    status: after.value === expectedUrl ? "ok" : "partial",
+    productId: prep.productId,
+    currentPage: prep.currentPage,
+    categoryName,
+    requested,
+    selected: selection.picked[0],
+    alreadyPresent: selection.alreadyPresent || [],
+    expectedUrl,
+    before,
+    after,
+    searchUsed: selection.searchUsed,
+    searchFallback: selection.searchFallback,
+    searchKeyword: selection.searchKeyword,
+  };
+}
+
+async function actionImageUpload(productId, sectionType, categoryName, uploadFile, allowCurrentPage, expectedProductId, options = {}) {
+  const prep = await ensureImagePage(productId, allowCurrentPage, expectedProductId);
+  if (prep.status !== "ok") return prep;
+  const normalizedSection = sectionType === "white" ? "white" : "thumbs";
+  const absoluteUploadFile = path.isAbsolute(String(uploadFile || ""))
+    ? String(uploadFile || "")
+    : path.resolve(String(uploadFile || ""));
+  if (!absoluteUploadFile) return { status: "error", message: "uploadFile is required" };
+  if (!fs.existsSync(absoluteUploadFile)) return { status: "error", message: "Upload file not found: " + absoluteUploadFile };
+
+  const imageSel = getImageSelectors();
+  const before = await readImageSectionState(normalizedSection);
+  const uploadedFileName = path.basename(absoluteUploadFile);
+  await openImageModal(normalizedSection);
+  if (categoryName) await clickImageCategory(categoryName);
+
+  const duplicateCheck = await selectMaterialCardsByNames([uploadedFileName], {
+    select: false,
+    suppressMissingError: true,
+    searchText: uploadedFileName,
+  });
+  const duplicateMatches = (duplicateCheck && duplicateCheck.picked) || [];
+  if (duplicateMatches.length > 0 && options.allowDuplicateFileName !== true) {
+    await cancelImageModal();
+    return {
+      status: "error",
+      message: "Duplicate material names found before upload",
+      uploadFile: absoluteUploadFile,
+      uploadedFileName,
+      sectionType: normalizedSection,
+      duplicates: duplicateMatches,
+      searchUsed: duplicateCheck.searchUsed,
+      searchFallback: duplicateCheck.searchFallback,
+      searchKeyword: duplicateCheck.searchKeyword,
+    };
+  }
+  if (duplicateCheck && duplicateCheck.searchUsed) {
+    await clearMaterialSearch().catch(() => {});
+  }
+
+  const fileInputSelector = imageSel.modalFileInput || "input.box_uploading_img_file";
+  const fileInput = await page.$(fileInputSelector);
+  if (!fileInput) throw new Error("Image modal file input not found");
+  await fileInput.setInputFiles(absoluteUploadFile);
+  await page.waitForTimeout(2000);
+  await page.waitForLoadState("networkidle").catch(() => {});
+
+  const selection = await selectMaterialCardsByNames([uploadedFileName], {
+    searchText: uploadedFileName,
+  });
+  if (selection.status !== "ok") return { ...selection, uploadFile: absoluteUploadFile, uploadedFileName, sectionType: normalizedSection };
+
+  const uploaded = selection.picked[0] || null;
+  const expectedUrl = uploaded ? normalizeMaterialUrl(uploaded.imgUrl) : "";
+  const shouldConfirm = options && options.confirmSelection !== false;
+
+  if (shouldConfirm) {
+    if (normalizedSection === "white") {
+      await confirmImageModal();
+      const after = await readImageSectionState("white");
+      return {
+        status: after.value === expectedUrl ? "ok" : "partial",
+        productId: prep.productId,
+        currentPage: prep.currentPage,
+        sectionType: normalizedSection,
+        categoryName,
+        uploadFile: absoluteUploadFile,
+        uploadedFileName,
+        uploaded,
+        expectedUrl,
+        before,
+        after,
+        confirmed: true,
+        searchUsed: selection.searchUsed,
+        searchFallback: selection.searchFallback,
+        searchKeyword: selection.searchKeyword,
+      };
+    }
+
+    await confirmImageModal();
+    const after = await readImageSectionState("thumbs");
+    const appended = after.values.filter(url => !before.values.includes(url));
+    return {
+      status: after.values.includes(expectedUrl) ? "ok" : "partial",
+      productId: prep.productId,
+      currentPage: prep.currentPage,
+      sectionType: normalizedSection,
+      categoryName,
+      uploadFile: absoluteUploadFile,
+      uploadedFileName,
+      uploaded,
+      expectedUrl,
+      appended,
+      before,
+      after,
+      confirmed: true,
+      searchUsed: selection.searchUsed,
+      searchFallback: selection.searchFallback,
+      searchKeyword: selection.searchKeyword,
+    };
+  }
+
+  await cancelImageModal();
+  const afterCancel = await readImageSectionState(normalizedSection);
+  return {
+    status: uploaded ? "ok" : "partial",
+    productId: prep.productId,
+    currentPage: prep.currentPage,
+    sectionType: normalizedSection,
+    categoryName,
+    uploadFile: absoluteUploadFile,
+    uploadedFileName,
+    uploaded,
+    expectedUrl,
+    before,
+    after: afterCancel,
+    confirmed: false,
+    materialVisible: Boolean(uploaded),
+    searchUsed: selection.searchUsed,
+    searchFallback: selection.searchFallback,
+    searchKeyword: selection.searchKeyword,
+  };
 }
 
 // ================================================================
@@ -124,6 +1733,8 @@ async function actionLogin() {
   const sel = config.selectors.login;
   await page.goto(config.saas.loginUrl, { waitUntil: "networkidle" });
   const url = page.url();
+  const loginOrigin = checkSaasOrigin(url, config.saas.loginUrl);
+  if (!loginOrigin.ok) return { status: "error", message: "Login redirected to an untrusted origin", ...loginOrigin };
   if (!url.includes("login") && !url.includes("c=user")) {
     return { status: "ok", alreadyLoggedIn: true, url };
   }
@@ -139,6 +1750,8 @@ async function actionLogin() {
   }
   // Verify login succeeded: check URL or dashboard element
   const finalUrl = page.url();
+  const finalOrigin = checkSaasOrigin(finalUrl, config.saas.loginUrl);
+  if (!finalOrigin.ok) return { status: "error", message: "Login completed on an untrusted origin", ...finalOrigin };
   const loggedIn = !finalUrl.includes("login") && !finalUrl.includes("c=user");
   if (!loggedIn) {
     const dashEl = await page.$(config.selectors.login.successIndicator || ".user-avatar,.dashboard-header").catch(() => null);
@@ -150,17 +1763,24 @@ async function actionLogin() {
 // --- Ensure logged in ---
 async function ensureLogin() {
   const url = page.url();
-  if (url.includes("login") || url.includes("c=user")) {
+  if (!url || url === "about:blank" || url.includes("login") || url.includes("c=user")) {
     return await actionLogin();
   }
+  const originCheck = checkSaasOrigin(url, config.saas.loginUrl || config.saas.baseUrl);
+  if (!originCheck.ok) return { status: "error", message: "Current page is on an untrusted origin", ...originCheck };
   return { status: "ok", alreadyLoggedIn: true };
 }
 
 // --- Navigate ---
 async function actionNavigate(productId) {
+  const validation = await navigateProductTab(page, productId);
+  return validation.status === "ok" ? { ...validation, url: page.url() } : validation;
+}
+
+async function navigateProductTab(tab, productId) {
   const url = config.saas.productDetailUrl.replace("{productId}", productId);
-  await page.goto(url, { waitUntil: "networkidle" });
-  return { status: "ok", url };
+  await tab.goto(url, { waitUntil: "networkidle" });
+  return validateProductPageAfterNavigation(tab.url(), productId, config.saas.productDetailUrl, false);
 }
 
 // --- Discover specs ---
@@ -179,11 +1799,13 @@ async function discoverSpecs() {
 
 // --- Read ---
 async function actionRead(productId, fields) {
-  await actionNavigate(productId);
+  const initialNavigation = await actionNavigate(productId);
+  if (initialNavigation.status !== "ok") return initialNavigation;
   await ensureLogin();
   // Re-navigate: login may have redirected away from product page
   if (page.url().includes("c=site") && !page.url().includes("goods.edit")) {
-    await actionNavigate(productId);
+    const loginNavigation = await actionNavigate(productId);
+    if (loginNavigation.status !== "ok") return loginNavigation;
   }
   await page.waitForTimeout(1500);
 
@@ -193,16 +1815,23 @@ async function actionRead(productId, fields) {
     return { status: "error", productId, message: "no specs found; product may not exist or page structure changed", url: page.url() };
   }
   const explicitFields = Array.isArray(fields) && fields.length > 0;
-  const selectableFields = explicitFields ? fields : getProductFields();
+  const staticFields = explicitFields ? fields : getProductFields();
 
-  const result = { status: "ok", productId, specs: specs.map(s => ({ specId: s.specId, title: s.title })), values: {}, warnings: [], missingFields: [] };
+  const result = { status: "ok", productId, specs: specs.map(s => ({ specId: s.specId, title: s.title })), values: {}, warnings: [], missingFields: [], dynamicRentFields: {} };
   let requestedCount = 0;
   let readCount = 0;
   for (const spec of specs) {
     const specValues = {};
-    for (const field of selectableFields) {
+    // Determine fields to read: static + dynamically discovered rent fields
+    let fieldsToRead = staticFields;
+    if (!explicitFields) {
+      const rentFields = await discoverRentFieldsForSpec(page, spec.specId);
+      result.dynamicRentFields[spec.specId] = rentFields;
+      fieldsToRead = [...staticFields, ...Object.keys(rentFields)];
+    }
+    for (const field of fieldsToRead) {
       requestedCount++;
-      const selector = resolveSelector(sel[field], spec.specId);
+      const selector = resolveFieldSelector(field, spec.specId);
       if (!selector) {
         const warning = { level: "error", specId: spec.specId, field, message: "Selector not configured" };
         result.warnings.push(warning);
@@ -256,7 +1885,7 @@ async function applyFieldsOnPage(raw, specs) {
       result.applied[specId] = {};
       for (const [field, newValue] of Object.entries(fields)) {
         result.requestedCount++;
-        const selector = resolveSelector(sel[field], specId);
+        const selector = resolveFieldSelector(field, specId);
         if (!selector) {
           result.failures.push({ specId, field, error: "Selector not configured" });
           continue;
@@ -276,7 +1905,7 @@ async function applyFieldsOnPage(raw, specs) {
       result.applied[spec.specId] = {};
       for (const [field, newValue] of Object.entries(raw)) {
         result.requestedCount++;
-        const selector = resolveSelector(sel[field], spec.specId);
+        const selector = resolveFieldSelector(field, spec.specId);
         if (!selector) {
           result.failures.push({ specId: spec.specId, field, error: "Selector not configured" });
           continue;
@@ -297,10 +1926,12 @@ async function applyFieldsOnPage(raw, specs) {
 }
 
 async function actionApply(productId, changesFile) {
-  await actionNavigate(productId);
+  const initialNavigation = await actionNavigate(productId);
+  if (initialNavigation.status !== "ok") return initialNavigation;
   await ensureLogin();
   if (page.url().includes("c=site") && !page.url().includes("goods.edit")) {
-    await actionNavigate(productId);
+    const loginNavigation = await actionNavigate(productId);
+    if (loginNavigation.status !== "ok") return loginNavigation;
   }
   await page.waitForTimeout(1500);
   if (!fs.existsSync(changesFile)) return { status: "error", message: "Changes file not found: " + changesFile };
@@ -319,59 +1950,112 @@ async function actionApplyOnPage(changesFile, expectedProductId) {
 }
 
 // --- Submit ---
-async function actionSubmit() {
+async function actionSubmit(expectedProductId) {
+  if (expectedProductId === undefined || expectedProductId === null || String(expectedProductId).trim() === "") {
+    return { status: "error", step: "submit-precheck", message: "expectedProductId is required", sideEffectPossible: false };
+  }
+  const currentCheck = assertCurrentProduct(expectedProductId);
+  if (!currentCheck.ok) {
+    return { status: "error", step: "submit-precheck", message: "Current page product mismatch", sideEffectPossible: false, ...currentCheck };
+  }
   const sel = config.selectors.product;
-  const saveBtn = await page.$(sel.saveButton);
-  if (!saveBtn) {
-    const alt = await page.$("input[type=submit],button:has-text('淇濆瓨')");
-    if (alt) await alt.click();
-    else return { status: "error", message: "Save button not found" };
-  } else {
+  const initialDismiss = await dismissBlockingDialogs();
+  const configuredToastSelector = typeof sel.saveSuccessToast === "string" ? sel.saveSuccessToast : null;
+  const toastSelectors = getSubmitToastSelectors(configuredToastSelector);
+  const toastBaseline = await readVisibleSubmitToastCandidates(toastSelectors);
+  const pageUrlBeforeSubmit = page.url();
+  const deadline = Date.now() + 15000;
+  const responseObserver = createSubmitResponseObserver(page, {
+    pageUrl: pageUrlBeforeSubmit,
+    expectedProductId,
+    timeoutMs: Math.max(1, deadline - Date.now()),
+    startArmed: false,
+  });
+
+  async function clickSaveButton() {
+    const saveBtn = await page.$(sel.saveButton);
+    if (!saveBtn) {
+      const alt = await page.$("input[type=submit],button:has-text('淇濆瓨')");
+      if (!alt) return { clicked: false, reason: "Save button not found" };
+      await alt.scrollIntoViewIfNeeded().catch(() => {});
+      await page.waitForTimeout(300);
+      await dispatchSubmitClick(alt, responseObserver);
+      return { clicked: true, selector: "fallback" };
+    }
     await saveBtn.scrollIntoViewIfNeeded();
     await page.waitForTimeout(300);
-    await saveBtn.click();
+    await dispatchSubmitClick(saveBtn, responseObserver);
+    return { clicked: true, selector: sel.saveButton };
   }
 
-  let success = false;
-  let detail = "";
-
-  // Check 1: URL redirect away from edit page
   try {
-    await page.waitForURL(u => !u.includes("goods.edit"), { timeout: 15000 });
-    success = true;
-    detail = "redirected";
-  } catch {
-    // Check 2: Success toast on same page (try multiple selectors)
-    const toastSels = [
-      ".layui-layer-dialog", ".layui-layer-msg", ".layui-layer",
-      ".alert-success", ".alert-info", ".toast", ".success", ".success_tip",
-      ".message", ".notification", "#msg", ".layui-m-layer",
-    ];
-    // Parallel detection 鈥?race all selectors, first match wins
-    const toastResult = await Promise.race(
-      toastSels.map(sel => page.waitForSelector(sel, { timeout: 3000 }).then(el => ({ sel, el })).catch(() => null))
-    );
-    if (toastResult) {
-      const text = await toastResult.el.textContent().catch(() => "");
-      if (text) {
-        success = true;
-        detail = "toast(" + toastResult.sel + "): " + text.trim().substring(0, 40);
+    try {
+      const clickResult = await clickSaveButton();
+      if (!clickResult.clicked) {
+        return { status: "error", message: clickResult.reason, dismissedDialogs: initialDismiss };
       }
-    }
-    // Check 3: URL changed even without full redirect
-    if (!success) {
-      const currentUrl = page.url();
-      if (!currentUrl.includes("goods.edit")) {
-        success = true;
-        detail = "url_changed: " + currentUrl.substring(0, 60);
+    } catch (err) {
+      const clickError = err && err.submitClickPhase === "trial" ? { disposition: "retry" } : classifySubmitClickError(err);
+      if (clickError.disposition === "unknown") {
+        return { ...clickError, detail: String(err && err.message || err), dismissedDialogs: initialDismiss };
+      }
+      if (clickError.disposition === "error") {
+        return { status: "error", message: clickError.message, dismissedDialogs: initialDismiss };
+      }
+      responseObserver.disarm();
+      const retryDismiss = await dismissBlockingDialogs();
+      try {
+        const retryClick = await clickSaveButton();
+        if (!retryClick.clicked) {
+          return { status: "error", message: retryClick.reason, dismissedDialogs: { before: initialDismiss, retry: retryDismiss } };
+        }
+      } catch (retryErr) {
+        const retryClickError = retryErr && retryErr.submitClickPhase === "trial"
+          ? { disposition: "error", status: "error", message: String(retryErr.message || retryErr) }
+          : classifySubmitClickError(retryErr);
+        if (retryClickError.disposition === "unknown") {
+          return { ...retryClickError, detail: String(retryErr && retryErr.message || retryErr), dismissedDialogs: { before: initialDismiss, retry: retryDismiss } };
+        }
+        return {
+          status: "error",
+          message: retryClickError.message || String(retryErr && retryErr.message || retryErr || err),
+          dismissedDialogs: { before: initialDismiss, retry: retryDismiss },
+        };
       }
     }
-    // Check 4: Page is still on edit but content indicates save (e.g., form values retained)
-    if (!success) await page.waitForTimeout(2000);
-  }
 
-  await page.waitForLoadState("networkidle").catch(() => {});
-  return { status: success ? "ok" : "unknown", submitted: success, detail, verified: success ? null : "check_with_readback" };
+    const pendingForever = new Promise(() => {});
+    const responseSignal = responseObserver.result.then(result => ({ source: "response", result }));
+    const redirectSignal = page.waitForURL(u => !u.toString().includes("goods.edit"), { timeout: Math.max(1, deadline - Date.now()) })
+      .then(() => ({ source: "redirect", result: { success: true, detail: "redirected" } }))
+      .catch(() => pendingForever);
+    const toastSignal = detectSubmitSuccessToast(configuredToastSelector, toastBaseline, deadline)
+      .then(result => result.success ? { source: "toast", result } : pendingForever);
+    const firstSignal = await Promise.race([responseSignal, redirectSignal, toastSignal]);
+
+    if (firstSignal.source !== "response") {
+      const graceMs = Math.min(350, Math.max(1, deadline - Date.now()));
+      const ajaxDuringGrace = await Promise.race([
+        responseObserver.result.then(result => ({ received: true, result })),
+        new Promise(resolve => setTimeout(() => resolve({ received: false }), graceMs)),
+      ]);
+      const externalDetails = firstSignal.source === "redirect"
+        ? { redirectDetail: firstSignal.result.detail }
+        : { toastDetail: firstSignal.result.detail };
+      const outcome = resolveImmediateSubmitOutcome({
+        responseResult: ajaxDuringGrace.received ? ajaxDuringGrace.result : { status: "unknown", detail: "no_matching_ajax_response" },
+        ...externalDetails,
+      });
+      return { ...outcome, dismissedDialogs: initialDismiss };
+    }
+
+    const responseResult = firstSignal.result;
+    const currentUrl = page.url();
+    const redirectDetail = currentUrl.includes("goods.edit") ? "" : "url_changed: " + currentUrl.substring(0, 60);
+    return { ...resolveImmediateSubmitOutcome({ responseResult, redirectDetail }), dismissedDialogs: initialDismiss };
+  } finally {
+    responseObserver.dispose();
+  }
 }
 
 // --- Spec management ---
@@ -569,13 +2253,14 @@ async function actionTenancySet(daysStr) {
   // Read new values from current page (don't navigate away)
   const specs = await discoverSpecs();
   if (specs.length === 0) return { status: "error", message: "no specs found after tenancy-set refresh", days };
-  const sel = config.selectors.product;
-  const flds = getProductFields();
+  const staticFlds = getProductFields();
   const vals = {};
   for (const spec of specs) {
     vals[spec.specId] = {};
-    for (const f of flds) {
-      const selector = resolveSelector(sel[f], spec.specId);
+    const rentFields = await discoverRentFieldsForSpec(page, spec.specId);
+    const allFlds = [...staticFlds, ...Object.keys(rentFields)];
+    for (const f of allFlds) {
+      const selector = resolveFieldSelector(f, spec.specId);
       if (!selector) continue;
       try { const el = await page.$(selector); vals[spec.specId][f] = el ? ((await el.inputValue()) || "").trim() : ""; } catch {}
     }
@@ -587,7 +2272,10 @@ async function actionTenancySet(daysStr) {
 async function findProductOnList(productId) {
   // Navigate to list with 100 per page
   await page.goto(config.saas.productListUrl + "&pagesize=100", { waitUntil: "networkidle" });
-  await ensureLogin();
+  const login = await ensureLogin();
+  if (login && login.status === "error") return login;
+  const initialPage = checkConfiguredPage(page.url(), config.saas.productListUrl);
+  if (!initialPage.ok) return { status: "error", message: "Product list navigation failed canonical validation", ...initialPage };
   await page.waitForTimeout(1500);
 
   // Search by product ID
@@ -597,6 +2285,8 @@ async function findProductOnList(productId) {
     await kwInput.press("Enter");
     await page.waitForTimeout(2000);
     await page.waitForLoadState("networkidle").catch(() => {});
+    const searchPage = checkConfiguredPage(page.url(), config.saas.productListUrl);
+    if (!searchPage.ok) return { status: "error", message: "Product list search navigation failed canonical validation", ...searchPage };
   }
 
   // Find the product row
@@ -610,6 +2300,8 @@ async function findProductOnList(productId) {
   // Fallback: scan pages (with 100 per page, fewer pages needed)
   for (let pg = 2; pg <= 5; pg++) {
     await page.goto(config.saas.productListUrl + "&pagesize=100&page=" + pg, { waitUntil: "networkidle" });
+    const pageCheck = checkConfiguredPage(page.url(), config.saas.productListUrl);
+    if (!pageCheck.ok) return { status: "error", message: "Product list pagination failed canonical validation", ...pageCheck };
     await page.waitForTimeout(1000);
     const link = await page.$(`a[href*="goods.edit&id=${productId}"]`);
     if (link) {
@@ -684,7 +2376,9 @@ function unknownCopyResult(productId, confirmText, extra = {}) {
 
 // --- Delist product ---
 async function actionDelist(productId) {
-  const { found, row } = await findProductOnList(productId);
+  const lookup = await findProductOnList(productId);
+  if (lookup.status === "error") return lookup;
+  const { found, row } = lookup;
   if (!found) return { status: "error", message: "Product not found: " + productId };
   const cb = await row.$("input[type='checkbox']");
   if (!cb) return { status: "error", message: "Checkbox not found in row" };
@@ -718,7 +2412,9 @@ async function actionDelist(productId) {
 
 // --- Copy product ---
 async function actionCopyProduct(productId) {
-  const { found, copyBtn } = await findProductOnList(productId);
+  const lookup = await findProductOnList(productId);
+  if (lookup.status === "error") return lookup;
+  const { found, copyBtn } = lookup;
   if (!found || !copyBtn) return { status: "error", message: "Product not found: " + productId };
   await copyBtn.click();
   await page.waitForTimeout(1500);
@@ -747,6 +2443,8 @@ async function actionCopyProduct(productId) {
   // Check if current page navigated (same-tab redirect) or new page opened
   const currentUrl = page.url();
   if (currentUrl.includes("goods.edit") || currentUrl.includes("goods.copy")) {
+    const destination = validateCopyDestination(currentUrl, productId, config.saas.productDetailUrl);
+    if (!destination.ok) return unknownCopyResult(productId, confirm.text, { currentUrl, message: "Copy destination failed canonical validation; save was not clicked" });
     // Same-tab navigation: we're on the copy/edit page with original product data
     const saveBtn = await page.$(config.selectors.product.saveButton).catch(() => null)
       || await page.$("input[type=submit],button:has-text('淇濆瓨')").catch(() => null);
@@ -762,7 +2460,7 @@ async function actionCopyProduct(productId) {
 
   // Check for new page/tab
   const pages = context.pages();
-  const newPage = pages.find(p => p !== page && p.url().includes("goods.edit"));
+  const newPage = pages.find(p => p !== page && validateCopyDestination(p.url(), productId, config.saas.productDetailUrl).ok);
   if (newPage) {
     await newPage.waitForLoadState("networkidle").catch(() => {});
     await newPage.waitForTimeout(1000);
@@ -889,10 +2587,13 @@ async function actionPlatformSearch(keyword) {
 }
 
 async function readProductOnTab(tab, productId, fields, explicitFields = false) {
-  await tab.goto(config.saas.productDetailUrl.replace("{productId}", productId), { waitUntil: "networkidle" });
+  const navigation = await navigateProductTab(tab, productId);
   await tab.waitForTimeout(1000);
   const url = tab.url();
   if (url.includes("login") || url.includes("c=user")) throw new Error("redirected to login");
+  if (navigation.status !== "ok") {
+    throw new Error(navigation.message + ": expected product " + productId + ", got " + (navigation.currentProductId || "unknown") + " at " + url);
+  }
 
   const specs = await tab.evaluate(() => {
     const result = [];
@@ -909,28 +2610,52 @@ async function readProductOnTab(tab, productId, fields, explicitFields = false)
   const vals = {};
   const warnings = [];
   const missingFields = [];
+  let requestedCount = 0;
+  let readCount = 0;
   const sel = config.selectors.product;
+  const dynamicRentFields = {};
   for (const spec of specs) {
     vals[spec.specId] = {};
-    for (const f of fields) {
-      const selector = resolveSelector(sel[f], spec.specId);
+    // Determine fields to read: static + dynamically discovered rent fields
+    let fieldsToRead = fields;
+    if (!explicitFields) {
+      const rentFields = await discoverRentFieldsForSpec(tab, spec.specId);
+      dynamicRentFields[spec.specId] = rentFields;
+      fieldsToRead = [...fields, ...Object.keys(rentFields)];
+    }
+    for (const f of fieldsToRead) {
+      requestedCount++;
+      const selector = resolveFieldSelector(f, spec.specId);
       if (!selector) {
         const item = { specId: spec.specId, field: f, message: "Selector not configured" };
         missingFields.push(item);
-        if (explicitFields) warnings.push({ level: "error", ...item });
+        warnings.push({ level: "error", ...item });
         continue;
       }
       try {
         const el = await tab.$(selector);
-        vals[spec.specId][f] = el ? ((await el.inputValue()) || "").trim() : "";
+        if (!el) {
+          const warning = { level: explicitFields ? "error" : "warn", specId: spec.specId, field: f, message: "Element not found" };
+          warnings.push(warning);
+          if (explicitFields) missingFields.push({ specId: spec.specId, field: f, message: warning.message });
+          continue;
+        }
+        const tag = await el.evaluate(node => node.tagName.toLowerCase());
+        let val;
+        if (tag === "input" || tag === "textarea") val = await el.inputValue();
+        else if (tag === "select") val = await el.evaluate(node => node.options[node.selectedIndex]?.textContent || node.value);
+        else val = await el.textContent();
+        vals[spec.specId][f] = (val || "").trim();
+        readCount++;
       } catch (err) {
-        warnings.push({ level: "warn", specId: spec.specId, field: f, message: err.message });
-        vals[spec.specId][f] = "";
+        const warning = { level: explicitFields ? "error" : "warn", specId: spec.specId, field: f, message: err.message };
+        warnings.push(warning);
+        if (explicitFields) missingFields.push({ specId: spec.specId, field: f, message: warning.message });
       }
     }
   }
-  const status = explicitFields && missingFields.length > 0 ? "partial" : "ok";
-  return { status, productId, url, specs: specs.map(s => ({ specId: s.specId, title: s.title })), values: vals, warnings, missingFields };
+  const status = explicitFields && missingFields.length > 0 ? (readCount > 0 ? "partial" : "error") : "ok";
+  return { status, productId, url, specs: specs.map(s => ({ specId: s.specId, title: s.title })), values: vals, warnings, missingFields, requestedCount, readCount, dynamicRentFields };
 }
 
 // --- Batch read: parallel multi-tab read (max 3 concurrent) ---
@@ -948,14 +2673,15 @@ async function actionBatchRead(productIds, fields) {
   for (let i = 0; i < productIds.length; i += 3) {
     const chunk = productIds.slice(i, i + 3).map(String);
     const jobs = chunk.map(async pid => {
-      const tab = await context.newPage();
+      let tab = null;
       try {
+        tab = await context.newPage();
         results[pid] = await readProductOnTab(tab, pid, flds, explicitFields);
         if (results[pid].warnings && results[pid].warnings.length > 0) warnings.push(...results[pid].warnings.map(w => ({ productId: pid, ...w })));
       } catch (err) {
         errors.push({ productId: pid, error: err.message });
       } finally {
-        await tab.close().catch(() => {});
+        if (tab) await tab.close().catch(() => {});
       }
     });
     await Promise.all(jobs);
@@ -1032,11 +2758,28 @@ async function ensureBrowser() {
 
 async function handleCommand(cmd) {
   const { action, productId, fields, changesFile, specDimId, itemTitle, days, allowCurrentPage, expectedProductId } = cmd;
+  const fileNames = cmd.fileNames;
+  const fileName = cmd.fileName;
+  const categoryName = cmd.categoryName;
+  const orderedUrls = cmd.orderedUrls;
+  const sectionType = cmd.sectionType;
+  const uploadFile = cmd.uploadFile;
+  const confirmSelection = cmd.confirmSelection;
+  const allowDuplicateFileName = cmd.allowDuplicateFileName;
+  const skipIfAlreadyPresent = cmd.skipIfAlreadyPresent;
+  const skipIfWhiteImageMatched = cmd.skipIfWhiteImageMatched;
+  const expectedImages = cmd.expectedImages;
+  const expectedVAS = cmd.expectedVAS;
+  const vasIds = cmd.ids;
+  const vasKeyword = cmd.keyword;
+  const submitValidation = validateSubmitCommand(cmd);
+  if (submitValidation && submitValidation.status === "error") return submitValidation;
 
   // Lazy init browser
   if (action !== "ping") {
     await ensureBrowser();
-    await ensureLogin();
+    const login = await ensureLogin();
+    if (login && login.status === "error") return login;
   }
 
   switch (action) {
@@ -1049,18 +2792,30 @@ async function handleCommand(cmd) {
       // Apply changes on current page without navigation
       if (!allowCurrentPage || !expectedProductId) return { status: "error", message: "apply-current requires allowCurrentPage=true and expectedProductId" };
       return await actionApplyOnPage(changesFile, expectedProductId);
-    case "submit":  return await actionSubmit();
+    case "submit":  return await actionSubmit(submitValidation.expectedProductId);
     case "spec-discover":
     case "spec-add-item":
     case "spec-add-dim":
-      if (productId) await actionNavigate(productId);
+      if (productId) {
+        const navigation = await actionNavigate(productId);
+        if (navigation.status !== "ok") return navigation;
+      } else if (!allowCurrentPage || !expectedProductId) {
+        return { status: "error", message: "productId is required unless allowCurrentPage=true and expectedProductId is provided" };
+      }
+      {
+        const currentCheck = assertCurrentProduct(expectedProductId || productId);
+        if (!currentCheck.ok) return { status: "error", message: "Current page product mismatch", ...currentCheck };
+      }
       if (action === "spec-discover") return await actionSpecDiscover();
       if (action === "spec-add-item") return await actionSpecAddItem(specDimId, itemTitle);
       if (action === "spec-add-dim") return await actionSpecAddDim(itemTitle);
       break;
     case "spec-remove-item":
     case "spec-remove-dim": {
-      if (productId) await actionNavigate(productId);
+      if (productId) {
+        const navigation = await actionNavigate(productId);
+        if (navigation.status !== "ok") return navigation;
+      }
       else if (!allowCurrentPage) return { status: "error", message: "productId is required unless allowCurrentPage is true", expectedProductId };
       const currentCheck = assertCurrentProduct(expectedProductId || productId);
       if (!currentCheck.ok) return { status: "error", message: "Current page product mismatch", ...currentCheck };
@@ -1069,7 +2824,10 @@ async function handleCommand(cmd) {
       break;
     }
     case "spec-add-and-refresh": {
-      if (productId) await actionNavigate(productId);
+      if (productId) {
+        const navigation = await actionNavigate(productId);
+        if (navigation.status !== "ok") return { ...navigation, step: "spec-precheck" };
+      }
       else if (!allowCurrentPage) return { status: "error", step: "spec-precheck", message: "productId is required unless allowCurrentPage is true", expectedProductId };
       const currentCheck = assertCurrentProduct(expectedProductId || productId);
       if (!currentCheck.ok) return { status: "error", step: "spec-precheck", message: "Current page product mismatch", ...currentCheck };
@@ -1107,13 +2865,14 @@ async function handleCommand(cmd) {
         return { status: "error", step: "spec-postcheck", message: "refreshed spec table does not include added item", specDimId, itemTitle: targetTitle, beforeRows: beforeSpecs.length, afterRows: specs.length };
       }
 
-      const sel = config.selectors.product;
-      const flds = getProductFields();
+      const staticFlds = getProductFields();
       const vals = {};
       for (const spec of specs) {
         vals[spec.specId] = {};
-        for (const f of flds) {
-          const selector = resolveSelector(sel[f], spec.specId);
+        const rentFields = await discoverRentFieldsForSpec(page, spec.specId);
+        const allFlds = [...staticFlds, ...Object.keys(rentFields)];
+        for (const f of allFlds) {
+          const selector = resolveFieldSelector(f, spec.specId);
           if (!selector) continue;
           try { const el = await page.$(selector); vals[spec.specId][f] = el ? ((await el.inputValue()) || "").trim() : ""; } catch {}
         }
@@ -1121,14 +2880,20 @@ async function handleCommand(cmd) {
       return { ...ar, itemTitle: targetTitle, refresh: rr, postcheck: { status: "ok", beforeRows: beforeSpecs.length, afterRows: specs.length, beforeHadItem }, specs: specs.map(s => ({ specId: s.specId, title: s.title })), values: vals };
     }
     case "spec-refresh": {
-      if (productId) await actionNavigate(productId);
+      if (productId) {
+        const navigation = await actionNavigate(productId);
+        if (navigation.status !== "ok") return navigation;
+      }
       else if (!allowCurrentPage) return { status: "error", message: "productId is required unless allowCurrentPage is true", expectedProductId };
       const currentCheck = assertCurrentProduct(expectedProductId || productId);
       if (!currentCheck.ok) return { status: "error", message: "Current page product mismatch", ...currentCheck };
       return await actionSpecRefresh();
     }
     case "tenancy-set": {
-      if (productId) await actionNavigate(productId);
+      if (productId) {
+        const navigation = await actionNavigate(productId);
+        if (navigation.status !== "ok") return navigation;
+      }
       else if (!allowCurrentPage) return { status: "error", message: "productId is required unless allowCurrentPage is true", expectedProductId };
       const currentCheck = assertCurrentProduct(expectedProductId || productId);
       if (!currentCheck.ok) return { status: "error", message: "Current page product mismatch", ...currentCheck };
@@ -1142,6 +2907,28 @@ async function handleCommand(cmd) {
       return await actionPlatformSearch(cmd.keyword || productId);
     case "batch-read":
       return await actionBatchRead(cmd.productIds, cmd.fields);
+    case "image-read":
+      return await actionImageRead(productId, allowCurrentPage, expectedProductId);
+    case "image-pick":
+      return await actionImagePick(productId, categoryName, fileNames, allowCurrentPage, expectedProductId, { skipIfAlreadyPresent });
+    case "image-order":
+      return await actionImageOrder(productId, orderedUrls, allowCurrentPage, expectedProductId);
+    case "white-image-set":
+      return await actionWhiteImageSet(productId, categoryName, fileName, allowCurrentPage, expectedProductId, { skipIfWhiteImageMatched });
+    case "image-upload":
+      return await actionImageUpload(productId, sectionType || "thumbs", categoryName, uploadFile, allowCurrentPage, expectedProductId, { confirmSelection, allowDuplicateFileName });
+    case "image-verify":
+      return await actionImageVerify(productId, expectedImages || {}, allowCurrentPage, expectedProductId);
+    case "vas-read":
+      return await actionVASRead(productId, allowCurrentPage, expectedProductId);
+    case "vas-catalog-read":
+      return await actionVASCatalogRead(productId, vasKeyword, vasIds, allowCurrentPage, expectedProductId);
+    case "vas-apply":
+      return await actionVASApply(productId, expectedVAS, allowCurrentPage, expectedProductId);
+    case "vas-verify":
+      return await actionVASVerify(productId, expectedVAS || {}, allowCurrentPage, expectedProductId);
+    case "discard-current-form":
+      return await actionDiscardCurrentForm(expectedProductId);
     default: return { status: "error", message: "Unknown action: " + action };
   }
 }
@@ -1193,21 +2980,26 @@ async function legacyMode(action, args) {
 }
 
 async function handleLegacyAction(action, args) {
-  await actionLogin();
+  if (action === "submit" && !args[0]) return { status: "error", message: "Usage: submit <productId>" };
+  const login = await actionLogin();
+  if (login && login.status === "error") return login;
 
   switch (action) {
-    case "login":  return { status: "ok", loggedIn: true };
+    case "login":  return login;
     case "navigate": return await actionNavigate(args[0]);
     case "read":   return await actionRead(args[0], args.slice(1));
     case "apply": {
       const result = await actionApply(args[0], args[1]);
-      if (args.includes("--submit")) {
-        const sr = await actionSubmit();
-        result.submit = sr;
+      const submitDecision = buildLegacyApplySubmitDecision(result, args.includes("--submit"));
+      if (submitDecision.shouldSubmit) {
+        const sr = await actionSubmit(args[0]);
+        return mergeLegacyApplySubmitOutcome(result, sr);
+      } else if (submitDecision.submitResult) {
+        result.submit = submitDecision.submitResult;
       }
       return result;
     }
-    case "submit": return await actionSubmit();
+    case "submit": return await actionSubmit(args[0]);
     case "verify": {
       // Read current values and compare with expected changes file
       const productId = args[0];
@@ -1217,18 +3009,7 @@ async function handleLegacyAction(action, args) {
       if (!fs.existsSync(changesFile)) return { status: "error", message: "Changes file not found: " + changesFile };
       const expected = JSON.parse(fs.readFileSync(changesFile, "utf-8"));
       delete expected.__broadcast;
-      const result = { status: "ok", productId, matches: {}, mismatches: [] };
-      for (const [specId, specValues] of Object.entries(current.values)) {
-        result.matches[specId] = {};
-        for (const [field, expectedVal] of Object.entries(expected)) {
-          const actual = specValues[field];
-          const match = actual !== undefined && actual === String(expectedVal);
-          result.matches[specId][field] = match;
-          if (!match) result.mismatches.push({ specId, field, expected: String(expectedVal), actual: actual || "(missing)" });
-        }
-      }
-      if (result.mismatches.length > 0) result.status = "mismatch";
-      return result;
+      return { productId, ...compareLegacyVerification(current, expected) };
     }
     case "screenshot": {
       await page.screenshot({ path: OUTPUT_DIR + "/" + (args[0] || "cap") + ".png" });
@@ -1241,6 +3022,18 @@ async function handleLegacyAction(action, args) {
       const ids = args[0] ? args[0].split(",") : [];
       return await actionBatchRead(ids);
     }
+    case "image-read": {
+      return await actionImageRead(args[0]);
+    }
+    case "image-upload": {
+      return await actionImageUpload(args[0], args[1] || "thumbs", args[2] || "", args[3], false, args[0], { confirmSelection: args[4] !== "false" });
+    }
+    case "image-verify": {
+      const expectedFile = args[1];
+      if (!expectedFile || !fs.existsSync(expectedFile)) return { status: "error", message: "Usage: image-verify <productId> <expected-images.json>" };
+      const expected = JSON.parse(fs.readFileSync(expectedFile, "utf-8"));
+      return await actionImageVerify(args[0], expected, false, args[0]);
+    }
     default: return { status: "error", message: "Unknown action: " + action };
   }
 }
@@ -1296,4 +3089,46 @@ async function main() {
   await legacyMode(args[0], args.slice(1));
 }
 
-main().catch(err => { die(err.message); });
+if (require.main === module) {
+  main().catch(err => { die(err.message); });
+} else {
+  module.exports = {
+    normalizeStatusText,
+    isSubmitSuccessText,
+    redactPreview,
+    matchesSubmitResponseEvidence,
+    classifySubmitResponseEvidence,
+    createSubmitResponseObserver,
+    excludeBaselineToastCandidates,
+    validateSubmitCommand,
+    buildLegacyApplySubmitDecision,
+    mergeLegacyApplySubmitOutcome,
+    compareLegacyVerification,
+	    checkExpectedProductUrl,
+	    validateProductPageAfterNavigation,
+	    checkSaasOrigin,
+	    validateCopyDestination,
+    classifySubmitClickError,
+    resolveImmediateSubmitOutcome,
+    dispatchSubmitClick,
+    normalizeMaterialUrl,
+	    compareImageState,
+	    compareVASState,
+	    actionVASApply,
+	    actionNavigate,
+	    actionLogin,
+	    actionBatchRead,
+	    findProductOnList,
+	    handleLegacyAction,
+	    classifyPlatformSearchExclusion,
+    filterPlatformProducts,
+    readProductOnTab,
+    isDynamicRentField,
+    resolveFieldSelector,
+    resolveDynamicRentSelector,
+	    getDynamicRentConfig,
+	    __setConfigForTest(nextConfig) { config = nextConfig; },
+	    __setPageForTest(nextPage) { page = nextPage; },
+	    __setContextForTest(nextContext) { context = nextContext; },
+	  };
+}
diff --git a/old/scripts/run-tests.sh b/new/scripts/run-tests.sh
index 136948a..9314223 100644
--- a/old/scripts/run-tests.sh
+++ b/new/scripts/run-tests.sh
@@ -1,74 +1,64 @@
 #!/bin/bash
-# Comprehensive test suite for rental-price-agent
+# Rental Price Agent regression suite
 # Run from skill root: bash scripts/run-tests.sh
 SKILL_DIR="D:/鏀逛环-skill鍖?.workbuddy/skills/rental-price-agent"
 NODE="C:/Users/ljh/.workbuddy/binaries/node/versions/22.22.2/node.exe"
 SEND="$NODE $SKILL_DIR/scripts/playwright-runner.js daemon send"
+BATCH="$SKILL_DIR/scripts/batch-runner.js"
+UNIT="$SKILL_DIR/scripts/run-unit-tests.js"
+FAILURES=0
 
-send() { echo "$1" | $NODE "$SKILL_DIR/scripts/playwright-runner.js" daemon send 2>/dev/null | head -3; }
+send() { echo "$1" | $NODE "$SKILL_DIR/scripts/playwright-runner.js" daemon send 2>/dev/null | head -5; }
 ok()  { echo "  鉁?$1"; }
-err() { echo "  鉂?$1"; }
+err() { echo "  鉂?$1"; FAILURES=$((FAILURES + 1)); }
 hdr() { echo ""; echo "=== $1 ==="; }
 
 # ============================================================
-echo "馃И Rental Price Agent 瀹屾暣娴嬭瘯"
+echo "馃И Rental Price Agent 鍥炲綊娴嬭瘯"
 echo ""; date
 
-hdr "T1 - Daemon 杩為€?
+hdr "T1 - 鏃犲壇浣滅敤鍗曟祴"
+$NODE "$UNIT" && ok "Unit tests" || err "Unit tests"
+
+hdr "T2 - Daemon 杩為€?
 send '{"action":"ping"}' && ok "Ping" || err "Ping"
 
-hdr "T2 - Login"
+hdr "T3 - Login"
 send '{"action":"login"}' && ok "Login" || err "Login"
 
-hdr "T3 - 璇?61 (2琛?"
+hdr "T4 - 璇?61"
 R=$(send '{"action":"read","productId":"761"}')
 echo "$R" | head -2
 [ -n "$R" ] && ok "Read 761" || err "Read 761"
 
-hdr "T4 - 璇?63 (4琛?"
-R=$(send '{"action":"read","productId":"763"}')
-echo "$R" | head -2
-[ -n "$R" ] && ok "Read 763" || err "Read 763"
-
-hdr "T5 - Spec: 761鍔?28G"
-send '{"action":"spec-add-item","productId":"761","specDimId":"1355","itemTitle":"128G"}' && ok "Add item" || err "Add item"
+hdr "T5 - batch-read explicitFields"
+R=$(send '{"action":"batch-read","productIds":["761"],"fields":["rent1day","rent10day"]}')
+echo "$R" | head -3
+[ -n "$R" ] && ok "Batch read explicit fields" || err "Batch read explicit fields"
 
-hdr "T6 - Spec: Refresh"
-send '{"action":"spec-refresh","productId":"761"}' && ok "Refresh" || err "Refresh"
+hdr "T6 - 棰勮鏅€氭壒娆?浠?61)"
+$NODE "$BATCH" preview "D:/鏀逛环-skill鍖?.workbuddy/skills/rental-price-agent/tasks/batches/v14_preview_plain_761.json" 2>/dev/null | head -3 && ok "Batch preview plain" || err "Batch preview plain"
 
-hdr "T7 - Spec: 璇绘柊琛?鍘熷瓙add-and-refresh)"
-R=$(echo '{"action":"spec-add-and-refresh","productId":"761","specDimId":"1355","itemTitle":"128G"}' | $SEND)
-N=$(echo "$R" | grep -o '"specId"' | wc -l)
-echo "  Rows: $N"
-[ "$N" -ge 4 ] && ok "Atomic add+refresh ($N rows)" || err "Only $N rows"
-
-hdr "T8 - Spec: 鎭㈠(鍐嶆refresh)"
-echo '{"action":"spec-refresh","productId":"761"}' | $SEND && ok "Refresh" || err "Refresh"
-
-hdr "T9 - Spec: 纭2琛?
-R=$(echo '{"action":"spec-add-and-refresh","productId":"761","specDimId":"1355","itemTitle":"dummy"}' | $SEND; echo '{"action":"spec-refresh","productId":"761"}' | $SEND)
-# Note: read will show server state (original 2 rows) because spec changes aren't saved
-R=$(send '{"action":"read","productId":"761"}')
-N=$(echo "$R" | grep -o '"specId"' | wc -l)
-echo "  Rows (server): $N"
-ok "Spec restore flow"
+hdr "T7 - 棰勮闃绘柇 form-level shared setup"
+if $NODE "$BATCH" preview "D:/鏀逛环-skill鍖?.workbuddy/skills/rental-price-agent/tasks/batches/v14_preview_setup_shared_761.json" >/dev/null 2>/dev/null; then
+  err "Shared setup preview should be blocked"
+else
+  ok "Shared setup preview blocked"
+fi
 
-hdr "T11 - Tenancy: 761鍔?澶?
-send '{"action":"tenancy-set","productId":"761","days":"1,10,30,5"}' && ok "Set tenancy" || err "Set tenancy"
-
-hdr "T12 - Tenancy: 鎭㈠"
-send '{"action":"tenancy-set","productId":"761","days":"1,10,30"}' && ok "Restore tenancy" || err "Restore tenancy"
-
-hdr "T13 - 鎵归噺Preview (2鍟嗗搧宸紓)"
-NODE="C:/Users/ljh/.workbuddy/binaries/node/versions/22.22.2/node.exe"
-BATCH="$SKILL_DIR/scripts/batch-runner.js"
-$NODE "$BATCH" preview "D:/鏀逛环-skill鍖?.workbuddy/skills/rental-price-agent/tasks/test2_diff.json" 2>/dev/null | head -3 && ok "Batch preview" || err "Batch preview"
-
-hdr "T14 - 鎵归噺Execute (2鍟嗗搧宸紓) - 骞茶窇(涓嶆彁浜?"
-# Just read + diff, skip apply+submit
-$NODE "$BATCH" preview "D:/鏀逛环-skill鍖?.workbuddy/skills/rental-price-agent/tasks/test1_uniform.json" 2>/dev/null | head -3 && ok "Batch preview 2" || err "Batch preview 2"
+hdr "T8 - 棰勮闃绘柇 form-level item setup"
+if $NODE "$BATCH" preview "D:/鏀逛环-skill鍖?.workbuddy/skills/rental-price-agent/tasks/batches/v14_preview_setup_item_761.json" >/dev/null 2>/dev/null; then
+  err "Item setup preview should be blocked"
+else
+  ok "Item setup preview blocked"
+fi
 
 echo ""
 echo "===================="
 echo "娴嬭瘯瀹屾垚"
 echo "===================="
+
+if [ "$FAILURES" -gt 0 ]; then
+  echo "澶辫触椤? $FAILURES"
+  exit 1
+fi
diff --git a/new/scripts/run-unit-tests.js b/new/scripts/run-unit-tests.js
new file mode 100644
index 0000000..16f44c0
--- /dev/null
+++ b/new/scripts/run-unit-tests.js
@@ -0,0 +1,1691 @@
+#!/usr/bin/env node
+
+const assert = require("assert");
+const { EventEmitter } = require("events");
+const path = require("path");
+const fs = require("fs");
+const os = require("os");
+
+const batchRunner = require("./batch-runner.js");
+const pwRunner = require("./playwright-runner.js");
+const mirrorSearch = require("./mirror-search.js");
+const vasModel = require("./lib/vas-model.js");
+
+const tests = [];
+
+function test(name, fn) {
+  tests.push({ name, fn });
+}
+
+function makeManualTimers() {
+  const entries = [];
+  return {
+    api: {
+      setTimeout(fn, delay) {
+        const entry = { fn, delay, active: true };
+        entries.push(entry);
+        return entry;
+      },
+      clearTimeout(entry) {
+        if (entry) entry.active = false;
+      },
+    },
+    activeDelays() {
+      return entries.filter(entry => entry.active).map(entry => entry.delay);
+    },
+    run(delay) {
+      const entry = entries.find(candidate => candidate.active && candidate.delay === delay);
+      assert.ok(entry, "expected active timer with delay " + delay + ", got " + this.activeDelays().join(","));
+      entry.active = false;
+      entry.fn();
+    },
+  };
+}
+
+function fakeSubmitResponse(bodyPromise, overrides = {}) {
+  const request = overrides.request || { method: () => overrides.method || "POST" };
+  return {
+    url: () => overrides.url || "https://example.test/web/index.php?r=goods.edit&id=761",
+    request: () => request,
+    status: () => overrides.httpStatus || 200,
+    headers: () => ({ "content-type": overrides.contentType || "application/json" }),
+    text: async () => bodyPromise,
+  };
+}
+
+function extractActiveExampleText(text, extension) {
+  if (extension === ".md") {
+    const fenced = [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map(match => match[1]);
+    const inlineJson = [...text.matchAll(/`(\{[^`]*(?:"action"|"productId")[^`]*\})`/g)].map(match => match[1]);
+    return fenced.concat(inlineJson).join("\n");
+  }
+  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
+}
+
+function makeFakeTab({ url = "https://example.test/web/index.php?c=site&a=entry&m=ewei_shopv2&do=web&r=goods.edit&id=761", redirectUrl = "", specs = [], elements = {}, rentFields = {} } = {}) {
+  let currentUrl = url;
+  return {
+    async goto(targetUrl) { currentUrl = redirectUrl || targetUrl; },
+    async waitForTimeout() {},
+    url() { return currentUrl; },
+    async evaluate(fn, params) {
+      // Rent field discovery receives params with specId
+      if (params && params.specId !== undefined) {
+        return rentFields[String(params.specId)] || {};
+      }
+      // Specs discovery (no params)
+      const src = String(fn);
+      if (src.includes("#options table tbody tr")) {
+        return specs;
+      }
+      throw new Error("Unexpected evaluate call in fake tab");
+    },
+    async $(selector) {
+      if (!(selector in elements)) return null;
+      const entry = elements[selector];
+      if (entry === null) return null;
+      return {
+        async inputValue() {
+          if (entry.throwInputValue) throw new Error(entry.throwInputValue);
+          return entry.value;
+        },
+        async textContent() {
+          return entry.value;
+        },
+        async evaluate(fn) {
+          const src = String(fn);
+          if (src.includes("tagName.toLowerCase")) return entry.tag || "input";
+          if (entry.tag === "select" && src.includes("selectedIndex")) return entry.value;
+          return entry.value;
+        },
+      };
+    },
+  };
+}
+
+const vasCatalog = [
+  { id: "1", service_name: "瀹夊績淇?, service_money: "20.00", describe: "A" },
+  { id: "2", service_name: "瀹夊績淇?, service_money: "30.00", describe: "B" },
+  { id: "8", service_name: "鎷嶇珛寰楃浉绾?0寮?, service_money: "70.00" },
+];
+
+const vasCurrent = {
+  enabled: true,
+  platforms: ["wechat", "h5"],
+  services: [
+    { id: "1", serviceName: "瀹夊績淇?, serviceMoney: "20.00", defaultSelected: false, isForce: false, isPopup: false, metadata: { describe: "A", disclaimer: "", protectionScope: "", claimProcess: "", specialInstruction: "", picDesc: "" } },
+    { id: "8", serviceName: "鎷嶇珛寰楃浉绾?0寮?, serviceMoney: "70.00", defaultSelected: false, isForce: false, isPopup: false, metadata: { describe: "", disclaimer: "", protectionScope: "", claimProcess: "", specialInstruction: "", picDesc: "" } },
+  ],
+};
+
+function assertValidationError(plan, pattern, current = vasCurrent, catalog = vasCatalog) {
+  const result = vasModel.validateVASPlan(vasModel.normalizeVASPlan(plan), current, catalog);
+  assert.equal(result.ok, false);
+  assert.ok(result.errors.some(message => pattern.test(message)), JSON.stringify(result.errors));
+}
+
+test("normalizeVASPlan 闃绘 services.set 涓?patch 鍐茬獊", () => {
+  const plan = vasModel.normalizeVASPlan({ services: { set: [{ id: "1" }], remove: ["2"] } });
+  assert.ok(plan.errors.some(message => /cannot be combined/.test(message)));
+});
+
+test("normalizeVASPlan 鎷掔粷绫诲瀷閿欒锛屼笉鎶婂畠浠潤榛樺彉鎴?false 鎴栫┖鏁扮粍", () => {
+  const plan = vasModel.normalizeVASPlan({
+    enabled: "true",
+    platforms: "wechat",
+    services: { set: {}, upsert: "bad", remove: { id: "1" } },
+  });
+  assert.ok(plan.errors.some(message => /enabled must be boolean/.test(message)));
+  assert.ok(plan.errors.some(message => /platforms must be an array/.test(message)));
+  assert.ok(plan.errors.some(message => /services\.set must be an array/.test(message)));
+  assert.ok(plan.errors.some(message => /services\.upsert must be an array/.test(message)));
+  assert.ok(plan.errors.some(message => /services\.remove must be an array/.test(message)));
+  assert.equal(plan.enabled, undefined);
+  assert.equal(plan.platforms, undefined);
+});
+
+test("normalizeVASPlan 鎷掔粷鏈嶅姟甯冨皵閫夐」鐨勫瓧绗︿覆浼€?, () => {
+  const plan = vasModel.normalizeVASPlan({ services: { set: [{ id: "1", defaultSelected: "true", isForce: 1, isPopup: null }] } });
+  assert.ok(plan.errors.some(message => /defaultSelected must be boolean/.test(message)));
+  assert.ok(plan.errors.some(message => /isForce must be boolean/.test(message)));
+  assert.ok(plan.errors.some(message => /isPopup must be boolean/.test(message)));
+  assert.equal(plan.services.set[0].defaultSelected, undefined);
+});
+
+test("validateVASPlan 闃绘闈炴硶骞冲彴", () => {
+  assertValidationError({ platforms: ["wechat", "desktop"] }, /Invalid VAS platform/);
+});
+
+test("VAS 鍚屽悕鏈嶅姟涓ユ牸鎸?ID 瀹氫綅", () => {
+  const target = vasModel.buildTargetVASState(vasCurrent, vasModel.normalizeVASPlan({ services: { set: [{ id: "2" }] } }), vasCatalog);
+  assert.equal(target.services[0].id, "2");
+  assert.equal(target.services[0].serviceName, "瀹夊績淇?);
+  assert.equal(target.services[0].serviceMoney, "30.00");
+});
+
+test("VAS upsert/remove 鏋勫缓骞傜瓑鐩爣", () => {
+  const plan = vasModel.normalizeVASPlan({ services: { upsert: [{ id: "1", isPopup: true }, { id: "2" }], remove: ["8"] } });
+  const once = vasModel.buildTargetVASState(vasCurrent, plan, vasCatalog);
+  const twice = vasModel.buildTargetVASState(once, plan, vasCatalog);
+  assert.deepEqual(twice, once);
+  assert.deepEqual(once.services.map(service => service.id), ["1", "2"]);
+});
+
+test("validateVASPlan 闃绘澶氫釜 isPopup", () => {
+  assertValidationError({ services: { set: [{ id: "1", isPopup: true }, { id: "8", isPopup: true }] } }, /At most one/);
+});
+
+test("normalizeVASPlan 涓?force 鎺ㄥ defaultSelected", () => {
+  const plan = vasModel.normalizeVASPlan({ services: { set: [{ id: "1", isForce: true }] } });
+  assert.equal(plan.services.set[0].defaultSelected, true);
+});
+
+test("validateVASPlan 闃绘 force 涓庢樉寮?default false", () => {
+  assertValidationError({ services: { set: [{ id: "1", isForce: true, defaultSelected: false }] } }, /requires defaultSelected=true/);
+});
+
+test("validateVASPlan 闃绘 force 涓?popup 鍚屾椂寮€鍚?, () => {
+  assertValidationError({ services: { set: [{ id: "1", isForce: true, isPopup: true }] } }, /requires isPopup=false/);
+});
+
+test("validateVASPlan 闃绘 expectedName 鍜?expectedMoney 涓嶅尮閰?, () => {
+  const result = vasModel.validateVASPlan(
+    vasModel.normalizeVASPlan({ services: { set: [{ id: "1", expectedName: "閿欒鍚嶇О", expectedMoney: "99.00" }] } }),
+    vasCurrent,
+    vasCatalog
+  );
+  assert.equal(result.ok, false);
+  assert.ok(result.errors.some(message => /expectedName mismatch/.test(message)));
+  assert.ok(result.errors.some(message => /expectedMoney mismatch/.test(message)));
+});
+
+test("compareVASState 骞冲彴鏃犲簭浣嗘湇鍔″拰鍏冩暟鎹簿纭瘮杈?, () => {
+  const same = vasModel.compareVASState({ ...vasCurrent, platforms: ["h5", "wechat"] }, vasCurrent);
+  assert.equal(same.match, true);
+  const reordered = vasModel.compareVASState({ ...vasCurrent, services: [...vasCurrent.services].reverse() }, vasCurrent);
+  assert.equal(reordered.match, false);
+  assert.ok(reordered.mismatches.some(item => item.field === "serviceIds"));
+  const metadataChanged = JSON.parse(JSON.stringify(vasCurrent));
+  metadataChanged.services[0].metadata.describe = "changed";
+  const metadataResult = vasModel.compareVASState(metadataChanged, vasCurrent);
+  assert.equal(metadataResult.match, false);
+  assert.ok(metadataResult.mismatches.some(item => item.field === "services[0].metadata.describe"));
+});
+
+test("validateVASTargetState 鏍￠獙瀹屾暣蹇収绾︽潫", () => {
+  const valid = vasModel.validateVASTargetState(vasCurrent);
+  assert.equal(valid.ok, true);
+  const missing = vasModel.validateVASTargetState({});
+  assert.equal(missing.ok, false);
+  assert.ok(missing.errors.some(message => /target.enabled/.test(message)));
+  assert.ok(missing.errors.some(message => /target.platforms/.test(message)));
+  assert.ok(missing.errors.some(message => /target.services/.test(message)));
+  const invalid = vasModel.validateVASTargetState({ enabled: true, platforms: [], services: [{ ...vasCurrent.services[0], isForce: true, defaultSelected: false }] });
+  assert.equal(invalid.ok, false);
+  assert.ok(invalid.errors.some(message => /requires at least one platform/.test(message)));
+  assert.ok(invalid.errors.some(message => /requires defaultSelected=true/.test(message)));
+  const partialService = vasModel.validateVASTargetState({ enabled: false, platforms: [], services: [{ id: "1" }] });
+  assert.equal(partialService.ok, false);
+  assert.ok(partialService.errors.some(message => /serviceName string is required/.test(message)));
+  assert.ok(partialService.errors.some(message => /metadata object is required/.test(message)));
+});
+
+test("buildRollbackItem 浠呭洖婊氬疄闄呭彉鍖栧瓧娈靛苟淇濈暀瀹屾暣 VAS 蹇収", () => {
+  const vasBefore = JSON.parse(JSON.stringify(vasCurrent));
+  const item = batchRunner.buildRollbackItem({
+    productId: 761,
+    currentValues: { "3862": { rent1day: "22.00", rent45day: "399.00", stock: "5", finalPayment: "0.00", ignored: "x" } },
+    finalValues: { "3862": { rent1day: "22.00", rent45day: "450.00", stock: "6", finalPayment: "0.00" } },
+    vasBefore,
+  });
+  assert.deepEqual(item.vasSnapshot, vasBefore);
+  assert.equal(item.vas, undefined);
+  assert.equal(item.fields["3862"].rent45day, "399.00");
+  assert.equal(item.fields["3862"].stock, "5");
+  assert.equal(item.fields["3862"].rent1day, undefined);
+  assert.equal(item.fields["3862"].finalPayment, undefined);
+  assert.equal(item.fields["3862"].ignored, undefined);
+});
+
+test("鍥炴粴鍊欓€夋帓闄?skipSubmit 鐨?preview_only 椤?, () => {
+  const committed = { productId: 761, status: "ok", currentValues: { "1": { rent1day: "10" } }, finalValues: { "1": { rent1day: "11" } } };
+  const previewOnly = { productId: 762, status: "preview_only", currentValues: { "1": { rent1day: "20" } } };
+  const verifyFailed = { productId: 763, status: "verify_failed", currentValues: { "1": { rent1day: "30" } }, finalValues: { "1": { rent1day: "31" } } };
+  const candidates = batchRunner.getRollbackCandidates({ completed: [committed, previewOnly], verifyFailed: [verifyFailed] });
+  assert.deepEqual(candidates.map(entry => entry.productId), [761, 763]);
+  assert.deepEqual(batchRunner.getCommittedEntries({ completed: [committed, previewOnly] }).map(entry => entry.productId), [761]);
+});
+
+test("buildRollbackItem 鍦ㄤ粎 VAS 鍥炴粴鏃朵笉鐢熸垚瀛楁鍥炴粴", () => {
+  const item = batchRunner.buildRollbackItem({
+    productId: 761,
+    currentValues: { "3862": { stock: "5", finalPayment: "0.00" } },
+    finalValues: { "3862": { stock: "5", finalPayment: "0.00" } },
+    vasBefore: { enabled: false, platforms: ["wechat"], services: [] },
+  });
+  assert.equal(item.productId, 761);
+  assert.equal(item.fields, undefined);
+  assert.deepEqual(item.vasSnapshot, { enabled: false, platforms: ["wechat"], services: [] });
+});
+
+test("buildVASDiff 杈撳嚭寮€鍏炽€佸钩鍙板拰鏈嶅姟鍙樻洿", () => {
+  const target = vasModel.buildTargetVASState(vasCurrent, vasModel.normalizeVASPlan({ enabled: false, platforms: ["app"], services: { set: [{ id: "2", defaultSelected: true }] } }), vasCatalog);
+  const diff = vasModel.buildVASDiff(vasCurrent, target);
+  assert.ok(diff.some(item => item.field === "enabled"));
+  assert.ok(diff.some(item => item.field === "platforms"));
+  assert.ok(diff.some(item => item.operation === "remove"));
+  assert.ok(diff.some(item => item.operation === "add"));
+});
+
+test("buildVASDiff 鏄剧ず绾湇鍔″厓鏁版嵁鍙樺寲", () => {
+  const target = JSON.parse(JSON.stringify(vasCurrent));
+  target.services[0].metadata.disclaimer = "鏈嶅姟鏉℃宸叉洿鏂?;
+  const diff = vasModel.buildVASDiff(vasCurrent, target);
+  const update = diff.find(item => item.specId === "(vas:1)");
+  assert.ok(update);
+  assert.equal(update.operation, "update");
+  assert.match(update.new, /鏈嶅姟鏉℃宸叉洿鏂?);
+});
+
+test("normalizeBatchItem 鍖呭惈姝ｅ紡 vas 涓庡吋瀹瑰埆鍚?, () => {
+  const formal = batchRunner.normalizeBatchItem({ items: [] }, { productId: 761, vas: { enabled: true } });
+  assert.equal(formal.vas.enabled, true);
+  const alias = batchRunner.normalizeBatchItem({ items: [] }, { productId: 761, valueAddedServices: { enabled: false } });
+  assert.equal(alias.vas.enabled, false);
+});
+
+test("normalizeImagePlan 瑙勮寖鍖栧浘鐗囪鍒掑苟闃绘鍐茬獊瀛楁", () => {
+  const plan = batchRunner.normalizeImagePlan({
+    pick: { category: "浜у搧鍥?, files: ["a.jpg", " b.jpg "], skipIfAlreadyPresent: true },
+    upload: { sectionType: "white", categoryName: "鐧藉簳", path: "D:/tmp/demo.png", allowDuplicateFileName: true },
+    whiteImage: { category: "鐧藉簳", name: "white.png", skipIfWhiteImageMatched: true },
+    orderedUrls: [" https://a/1.png "],
+    thumbnailFileName: "cover.png",
+  });
+  assert.equal(plan.pick.categoryName, "浜у搧鍥?);
+  assert.deepEqual(plan.pick.fileNames, ["a.jpg", "b.jpg"]);
+  assert.equal(plan.pick.skipIfAlreadyPresent, true);
+  assert.equal(plan.upload.sectionType, "white");
+  assert.equal(plan.upload.uploadFile, "D:/tmp/demo.png");
+  assert.equal(plan.upload.allowDuplicateFileName, true);
+  assert.equal(plan.whiteImage.fileName, "white.png");
+  assert.equal(plan.whiteImage.skipIfWhiteImageMatched, true);
+  assert.equal(plan.invalid, "orderedUrls and thumbnailFileName cannot be used together");
+});
+
+test("validateBatchSize 鎸?config.rules.maxBatchSize 鎷︽埅瓒呴檺鎵规", () => {
+  const ok = batchRunner.validateBatchSize({ items: [{ productId: 1 }, { productId: 2 }] }, { maxBatchSize: 2 });
+  assert.equal(ok.ok, true);
+  const bad = batchRunner.validateBatchSize({ items: [{ productId: 1 }, { productId: 2 }, { productId: 3 }] }, { maxBatchSize: 2 });
+  assert.equal(bad.ok, false);
+  assert.match(bad.message, /exceeds config\.rules\.maxBatchSize=2/);
+});
+
+test("validateBatchItems 鎷掔粷閲嶅鎴栭潪瑙勮寖 productId", () => {
+  assert.equal(batchRunner.validateBatchItems({ items: [{ productId: 761, fields: { stock: "5" } }, { productId: "761", fields: { stock: "6" } }] }).ok, false);
+  assert.equal(batchRunner.validateBatchItems({ items: [{ productId: "0761", fields: { stock: "5" } }] }).ok, false);
+  assert.equal(batchRunner.validateBatchItems({ items: [{ productId: 0, fields: { stock: "5" } }] }).ok, false);
+  assert.equal(batchRunner.validateBatchItems({ items: [{ productId: 761, fields: { stock: "5" } }, { productId: 762, fields: { stock: "6" } }] }).ok, true);
+});
+
+test("validateBatchItems 鎷掔粷 no-op 浣嗘帴鍙?shared setup 鐢熸晥椤?, () => {
+  assert.equal(batchRunner.validateBatchItems({ items: [{ productId: 761 }] }).ok, false);
+  assert.equal(batchRunner.validateBatchItems({ shared: { tenancySet: "1,10,30" }, items: [{ productId: 761 }] }).ok, true);
+});
+
+test("compareImageState 姣旇緝 thumbs銆乼humbnail銆亀hite", () => {
+  pwRunner.__setConfigForTest({ saas: { baseUrl: "https://example.com" } });
+  const actual = {
+    thumbs: { values: ["/img/a.png", "https://zloss.xinyongzu.cn/img/b.png"] },
+    thumbnail: "/img/a.png",
+    white: { value: "/white/c.png" },
+  };
+  const expected = {
+    thumbs: ["https://example.com/img/a.png", "https://zloss.xinyongzu.cn/img/b.png"],
+    thumbnail: "https://example.com/img/a.png",
+    white: "https://example.com/white/c.png",
+  };
+  const result = pwRunner.compareImageState(actual, expected);
+  assert.equal(result.mismatched, 0);
+  assert.equal(result.total, 3);
+});
+
+test("isSubmitSuccessText 鍙帴鍙楁垚鍔熻涔夋枃鏈?, () => {
+  assert.equal(pwRunner.isSubmitSuccessText(" 淇濆瓨鎴愬姛 "), true);
+  assert.equal(pwRunner.isSubmitSuccessText("operation success"), true);
+  assert.equal(pwRunner.isSubmitSuccessText("淇敼鎴愬姛"), true);
+  assert.equal(pwRunner.isSubmitSuccessText("鏇存柊鎴愬姛"), true);
+  assert.equal(pwRunner.isSubmitSuccessText("缂栬緫鎴愬姛"), true);
+  assert.equal(pwRunner.isSubmitSuccessText("淇濆瓨澶辫触锛岃閲嶈瘯"), false);
+  assert.equal(pwRunner.isSubmitSuccessText("淇敼鎴愬姛浣嗕繚瀛樺け璐?), false);
+  assert.equal(pwRunner.isSubmitSuccessText("鐭ラ亾浜?), false);
+});
+
+test("classifySubmitResponseEvidence 浠呭尮閰嶅綋鍓嶅晢鍝?goods.edit POST 骞朵繚瀹堝垎绫?, () => {
+  const options = {
+    pageUrl: "https://example.test/web/index.php?c=site&a=entry&m=ewei_shopv2&do=web&r=goods.edit&id=761",
+    expectedProductId: "761",
+  };
+  const base = {
+    url: options.pageUrl,
+    method: "POST",
+    httpStatus: 200,
+    contentType: "application/json; charset=utf-8",
+    bodyText: "",
+  };
+  assert.equal(pwRunner.classifySubmitResponseEvidence({ ...base, method: "GET", bodyText: '{"success":true}' }, options).status, "ignored");
+  assert.equal(pwRunner.classifySubmitResponseEvidence({ ...base, url: base.url.replace("id=761", "id=762"), bodyText: '{"success":true}' }, options).status, "ignored");
+  assert.equal(pwRunner.classifySubmitResponseEvidence({ ...base, httpStatus: 500, bodyText: '{"success":true}' }, options).status, "error");
+  assert.equal(pwRunner.classifySubmitResponseEvidence({ ...base, bodyText: "" }, options).status, "unknown");
+  assert.equal(pwRunner.classifySubmitResponseEvidence({ ...base, httpStatus: 204 }, options).status, "unknown");
+  assert.equal(pwRunner.classifySubmitResponseEvidence({ ...base, contentType: "text/html", bodyText: "<html>淇濆瓨鎴愬姛</html>" }, options).status, "unknown");
+  assert.equal(pwRunner.classifySubmitResponseEvidence({ ...base, bodyText: "not-json" }, options).status, "unknown");
+  assert.equal(pwRunner.classifySubmitResponseEvidence({ ...base, bodyText: '{"success":true,"message":"淇濆瓨澶辫触"}' }, options).status, "error");
+  assert.equal(pwRunner.classifySubmitResponseEvidence({ ...base, bodyText: '{"success":true,"message":"淇敼鎴愬姛"}' }, options).status, "ok");
+  assert.equal(pwRunner.classifySubmitResponseEvidence({ ...base, contentType: "text/plain", bodyText: "鏇存柊鎴愬姛" }, options).status, "ok");
+  const bounded = pwRunner.classifySubmitResponseEvidence({ ...base, contentType: "text/plain", bodyText: "x".repeat(2000) }, options);
+  assert.ok(bounded.bodyPreview.length <= 500);
+});
+
+test("classifySubmitResponseEvidence 鏀寔 ewei status/code=1 骞惰宓屽澶辫触娑堟伅浼樺厛", () => {
+  const options = { pageUrl: "https://example.test/web/index.php?r=goods.edit&id=761", expectedProductId: "761" };
+  const classify = bodyText => pwRunner.classifySubmitResponseEvidence({
+    url: options.pageUrl,
+    method: "POST",
+    httpStatus: 200,
+    contentType: "application/json",
+    bodyText,
+  }, options).status;
+  assert.equal(classify('{"status":1}'), "ok");
+  assert.equal(classify('{"status":"1"}'), "ok");
+  assert.equal(classify('{"code":1}'), "ok");
+  assert.equal(classify('{"code":"1"}'), "ok");
+  assert.equal(classify('{"status":0}'), "error");
+  assert.equal(classify('{"status":1,"result":{"message":"淇濆瓨澶辫触"}}'), "error");
+  assert.equal(classify('{"code":"1","data":{"msg":"鏇存柊閿欒"}}'), "error");
+  assert.equal(classify('{"code":2}'), "unknown");
+  assert.equal(classify('{"code":0}'), "unknown");
+  assert.equal(classify('{"code":200}'), "unknown");
+  assert.equal(classify('{"code":0,"result":{"message":"淇濆瓨澶辫触"}}'), "error");
+  assert.equal(classify('{"code":1,"data":{"success":false,"error":"save rejected"}}'), "error");
+  assert.equal(classify('{"code":1,"data":{"result":{"status":0,"message":"save rejected"}}}'), "error");
+});
+
+test("classifySubmitResponseEvidence 鎴柇閬嶅巻鏃朵笉鎺ュ彈鎴愬姛鏍囪", () => {
+  const options = { pageUrl: "https://example.test/web/index.php?r=goods.edit&id=761", expectedProductId: "761" };
+  const classify = body => pwRunner.classifySubmitResponseEvidence({
+    url: options.pageUrl,
+    method: "POST",
+    httpStatus: 200,
+    contentType: "application/json",
+    bodyText: JSON.stringify(body),
+  }, options);
+  const failureBeyondCap = Array.from({ length: 205 }, (_, index) => index === 0
+    ? { message: "淇濆瓨澶辫触" }
+    : { value: index });
+  const hiddenFailure = classify({ success: true, data: failureBeyondCap });
+  assert.equal(hiddenFailure.status, "unknown");
+  assert.equal(hiddenFailure.detail, "inspection_truncated");
+
+  const truncatedSuccess = classify({ success: true, data: Array.from({ length: 205 }, (_, index) => ({ value: index })) });
+  assert.equal(truncatedSuccess.status, "unknown");
+  assert.equal(truncatedSuccess.detail, "inspection_truncated");
+});
+
+test("submit evidence previews redact nested JSON, text credentials, and URL query secrets", () => {
+  const pageUrl = "https://example.test/web/index.php?r=goods.edit&id=761";
+  const classified = pwRunner.classifySubmitResponseEvidence({
+    url: pageUrl + "&token=url-secret&safe=kept",
+    method: "POST",
+    httpStatus: 200,
+    contentType: "application/json",
+    bodyText: JSON.stringify({
+      status: 1,
+      message: "saved",
+      data: { password: "json-secret", authorization: "Bearer bearer-secret", note: "kept" },
+    }),
+  }, { pageUrl, expectedProductId: "761" });
+  assert.equal(classified.status, "ok");
+  assert.match(classified.bodyPreview, /saved/);
+  assert.match(classified.bodyPreview, /kept/);
+  assert.doesNotMatch(classified.bodyPreview, /json-secret|bearer-secret/);
+  assert.match(classified.url, /safe=kept/);
+  assert.doesNotMatch(classified.url, /url-secret/);
+
+  const text = pwRunner.redactPreview("status=ok message=saved password=text-secret Authorization: Bearer auth-secret Cookie: sid=cookie-secret");
+  assert.match(text, /status=ok/);
+  assert.match(text, /message=saved/);
+  assert.doesNotMatch(text, /text-secret|auth-secret|cookie-secret/);
+  assert.ok(text.length <= 500);
+});
+
+test("playwright 涓?batch previews redact camelCase secret keys", () => {
+  const secretKeys = ["accessToken", "refreshToken", "clientSecret", "apiKey", "sessionId", "authToken"];
+  const payload = Object.fromEntries(secretKeys.map((key, index) => [key, "json-secret-" + index]));
+  const plainText = secretKeys.map((key, index) => key + (index % 2 === 0 ? "=" : ": ") + "text-secret-" + index).join(" ");
+  for (const redact of [pwRunner.redactPreview, batchRunner.redactPreview]) {
+    const jsonPreview = redact(payload);
+    const textPreview = redact(plainText);
+    assert.doesNotMatch(jsonPreview, /json-secret-/);
+    assert.doesNotMatch(textPreview, /text-secret-/);
+  }
+});
+
+test("post-navigation product validation rejects wrong product and route", () => {
+  const template = "https://example.test/web/index.php?r=goods.edit&id={productId}";
+  const wrongProduct = pwRunner.validateProductPageAfterNavigation(
+    "https://example.test/web/index.php?r=goods.edit&id=762",
+    "761",
+    template,
+    false
+  );
+  assert.equal(wrongProduct.status, "error");
+  assert.equal(wrongProduct.currentProductId, "762");
+
+  const wrongRoute = pwRunner.validateProductPageAfterNavigation(
+    "https://example.test/web/index.php?r=goods.list&id=761",
+    "761",
+    template,
+    false
+  );
+  assert.equal(wrongRoute.status, "error");
+});
+
+test("actionNavigate rejects a redirect to the wrong product before reporting success", async () => {
+  let currentUrl = "https://example.test/web/index.php?r=goods.edit&id=762";
+  pwRunner.__setConfigForTest({
+    saas: { productDetailUrl: "https://example.test/web/index.php?r=goods.edit&id={productId}" },
+  });
+  pwRunner.__setPageForTest({
+    async goto() {},
+    url() { return currentUrl; },
+  });
+  const result = await pwRunner.actionNavigate("761");
+  assert.equal(result.status, "error");
+  assert.equal(result.currentProductId, "762");
+});
+
+test("actionVASApply rejects failed readback even when an empty disabled target would compare equal", async () => {
+  let evaluateCount = 0;
+  const target = { enabled: false, platforms: [], services: [] };
+  pwRunner.__setConfigForTest({
+    saas: {
+      baseUrl: "https://example.test",
+      productDetailUrl: "https://example.test/web/index.php?r=goods.edit&id={productId}",
+    },
+    selectors: { vas: {} },
+  });
+  pwRunner.__setPageForTest({
+    url() { return "https://example.test/web/index.php?r=goods.edit&id=761"; },
+    async waitForTimeout() {},
+    async evaluate() {
+      evaluateCount++;
+      if (evaluateCount === 1) return { ok: true, optionResults: [] };
+      return { ok: false, missing: ["enabledRadio", "platformCheckbox", "list"] };
+    },
+  });
+  const result = await pwRunner.actionVASApply("761", target, true, "761");
+  assert.equal(result.status, "error");
+  assert.deepEqual(result.missing, ["enabledRadio", "platformCheckbox", "list"]);
+});
+
+test("actionLogin rejects a cross-origin redirect before filling credentials", async () => {
+  let filled = false;
+  pwRunner.__setConfigForTest({
+    saas: {
+      loginUrl: "https://trusted.example/web/index.php?c=user&a=login",
+      credentials: { username: "user", password: "secret" },
+    },
+    selectors: { login: { username: "#user", password: "#pass", submitButton: "#submit" } },
+  });
+  pwRunner.__setPageForTest({
+    async goto() {},
+    url() { return "https://attacker.example/login"; },
+    async $() { return {}; },
+    async fill() { filled = true; },
+    async click() {},
+  });
+  const result = await pwRunner.actionLogin();
+  assert.equal(result.status, "error");
+  assert.equal(filled, false);
+});
+
+test("copy destination validation rejects deceptive cross-origin edit routes", () => {
+  assert.equal(typeof pwRunner.validateCopyDestination, "function");
+  const result = pwRunner.validateCopyDestination(
+    "https://attacker.example/web/index.php?r=goods.edit&id=761",
+    "761",
+    "https://trusted.example/web/index.php?r=goods.edit&id={productId}"
+  );
+  assert.equal(result.ok, false);
+});
+
+test("actionBatchRead converts newPage failure into a structured batch error", async () => {
+  pwRunner.__setConfigForTest({
+    saas: { productDetailUrl: "https://example.test/web/index.php?r=goods.edit&id={productId}" },
+    selectors: { product: {} },
+  });
+  pwRunner.__setContextForTest({
+    async newPage() { throw new Error("page creation failed"); },
+  });
+  const result = await pwRunner.actionBatchRead(["761"], []);
+  assert.equal(result.status, "error");
+  assert.deepEqual(result.errors, [{ productId: "761", error: "page creation failed" }]);
+});
+
+test("legacy login propagates an untrusted-origin login failure", async () => {
+  pwRunner.__setConfigForTest({
+    saas: { loginUrl: "https://trusted.example/login", credentials: { username: "user", password: "secret" } },
+    selectors: { login: { username: "#user", password: "#pass", submitButton: "#submit" } },
+  });
+  pwRunner.__setPageForTest({
+    async goto() {},
+    url() { return "https://attacker.example/login"; },
+  });
+  const result = await pwRunner.handleLegacyAction("login", []);
+  assert.equal(result.status, "error");
+  assert.match(result.message, /untrusted origin/);
+});
+
+test("findProductOnList stops before DOM access when login origin validation fails", async () => {
+  let queried = false;
+  pwRunner.__setConfigForTest({
+    saas: {
+      loginUrl: "https://trusted.example/login",
+      productListUrl: "https://trusted.example/web/index.php?r=goods.list",
+    },
+  });
+  pwRunner.__setPageForTest({
+    async goto() {},
+    url() { return "https://attacker.example/web/index.php?r=goods.list"; },
+    async waitForTimeout() {},
+    async $() { queried = true; return null; },
+  });
+  const result = await pwRunner.findProductOnList("761");
+  assert.equal(result.status, "error");
+  assert.equal(queried, false);
+});
+
+test("findProductOnList revalidates the list page after keyword search navigation", async () => {
+  let currentUrl = "https://trusted.example/web/index.php?r=goods.list";
+  let queriedProductLink = false;
+  pwRunner.__setConfigForTest({
+    saas: {
+      loginUrl: "https://trusted.example/login",
+      productListUrl: "https://trusted.example/web/index.php?r=goods.list",
+    },
+  });
+  const keywordInput = {
+    async fill() {},
+    async press() { currentUrl = "https://attacker.example/web/index.php?r=goods.list"; },
+  };
+  pwRunner.__setPageForTest({
+    async goto() { currentUrl = "https://trusted.example/web/index.php?r=goods.list"; },
+    url() { return currentUrl; },
+    async waitForTimeout() {},
+    async waitForLoadState() {},
+    async $(selector) {
+      if (selector === "input[name='keyword']") return keywordInput;
+      queriedProductLink = true;
+      return null;
+    },
+  });
+  const result = await pwRunner.findProductOnList("761");
+  assert.equal(result.status, "error");
+  assert.equal(queriedProductLink, false);
+});
+
+test("classifySubmitResponseEvidence 鎶婂尮閰嶇殑 3xx 淇濇寔涓?unknown", () => {
+  const url = "https://example.test/web/index.php?r=goods.edit&id=761";
+  const result = pwRunner.classifySubmitResponseEvidence({
+    url,
+    method: "POST",
+    httpStatus: 302,
+    contentType: "text/html",
+    bodyText: "redirect",
+  }, { pageUrl: url, expectedProductId: "761" });
+  assert.equal(result.status, "unknown");
+  assert.equal(result.detail, "http_redirect_302");
+});
+
+test("validateSubmitCommand 瑕佹眰 daemon submit 鏄惧紡缁戝畾 expectedProductId", () => {
+  assert.equal(pwRunner.validateSubmitCommand({ action: "submit" }).status, "error");
+  assert.deepEqual(pwRunner.validateSubmitCommand({ action: "submit", expectedProductId: 761 }), { status: "ok", expectedProductId: "761" });
+  assert.equal(pwRunner.validateSubmitCommand({ action: "submit", expectedProductId: "0761" }).status, "error");
+  assert.equal(pwRunner.validateSubmitCommand({ action: "submit", expectedProductId: 0 }).status, "error");
+  assert.equal(pwRunner.validateSubmitCommand({ action: "submit", expectedProductId: -1 }).status, "error");
+  assert.equal(pwRunner.validateSubmitCommand({ action: "submit", expectedProductId: "abc" }).status, "error");
+  assert.equal(pwRunner.validateSubmitCommand({ action: "read" }), null);
+});
+
+test("checkExpectedProductUrl 鍦ㄦ彁浜ゅ墠鎷掔粷褰撳墠椤靛晢鍝佷笉鍖归厤", () => {
+  const template = "https://example.test/web/index.php?c=site&r=goods.edit&id={productId}";
+  const matched = pwRunner.checkExpectedProductUrl("https://example.test/web/index.php?r=goods.edit&id=761", 761, template);
+  const mismatched = pwRunner.checkExpectedProductUrl("https://example.test/web/index.php?r=goods.edit&id=762", 761, template);
+  assert.equal(matched.ok, true);
+  assert.equal(mismatched.ok, false);
+  assert.equal(mismatched.currentProductId, "762");
+  assert.equal(mismatched.expectedProductId, "761");
+  assert.equal(pwRunner.checkExpectedProductUrl("https://evil.test/web/index.php?r=goods.edit&id=761", 761, template).ok, false);
+  assert.equal(pwRunner.checkExpectedProductUrl("https://example.test/web/other.php?r=goods.edit&id=761", 761, template).ok, false);
+  assert.equal(pwRunner.checkExpectedProductUrl("https://example.test/web/index.php?r=goods.list&id=761", 761, template).ok, false);
+  assert.equal(pwRunner.checkExpectedProductUrl("https://example.test/web/index.php?r=goods.edit&id=0761", "0761", template).ok, false);
+});
+
+test("classifySubmitClickError 涓嶉噸璇曟淳鍙戠姸鎬佷笉鏄庣殑 click timeout", () => {
+  assert.deepEqual(pwRunner.classifySubmitClickError(new Error("Timeout 30000ms exceeded while waiting for click")), {
+    disposition: "unknown",
+    status: "unknown",
+    submitted: null,
+    sideEffectPossible: true,
+    retrySafe: false,
+  });
+  assert.equal(pwRunner.classifySubmitClickError(new Error("locator.click: Timeout 30000ms exceeded.")).disposition, "unknown");
+  assert.equal(pwRunner.classifySubmitClickError(new Error("element intercepts pointer events")).disposition, "retry");
+  assert.equal(pwRunner.classifySubmitClickError(new Error("element is not enabled")).disposition, "retry");
+  assert.equal(pwRunner.classifySubmitClickError(new Error("Target page closed")).disposition, "error");
+});
+
+test("resolveImmediateSubmitOutcome 浠呮樉寮忕綉缁滄垚鍔熷彲杩斿洖 ok", () => {
+  const redirectOnly = pwRunner.resolveImmediateSubmitOutcome({
+    responseResult: { status: "unknown", detail: "http_redirect_302" },
+    redirectDetail: "redirected_to_login",
+  });
+  const toastOnly = pwRunner.resolveImmediateSubmitOutcome({
+    responseResult: { status: "unknown", detail: "response_timeout" },
+    toastDetail: "toast(.message): 淇濆瓨鎴愬姛",
+  });
+  const changedUrl = pwRunner.resolveImmediateSubmitOutcome({
+    responseResult: { status: "unknown", detail: "empty_response" },
+    redirectDetail: "url_changed: https://example.test/login",
+  });
+  assert.equal(redirectOnly.status, "unknown");
+  assert.equal(redirectOnly.submitted, null);
+  assert.equal(toastOnly.status, "unknown");
+  assert.equal(toastOnly.submitted, null);
+  assert.equal(changedUrl.status, "unknown");
+  assert.equal(pwRunner.resolveImmediateSubmitOutcome({ responseResult: { status: "ok", detail: "explicit_json_success" } }).status, "ok");
+  assert.equal(pwRunner.resolveImmediateSubmitOutcome({ responseResult: { status: "error", detail: "explicit_json_failure" }, toastDetail: "淇濆瓨鎴愬姛" }).status, "error");
+});
+
+test("buildSubmitCommand 灏?batch submit 缁戝畾鍒板綋鍓?productId", () => {
+  assert.deepEqual(batchRunner.buildSubmitCommand(761), { action: "submit", expectedProductId: 761 });
+});
+
+test("createSubmitResponseObserver 鍦ㄥ搷搴旇鍙栧け璐ユ椂杩斿洖 unknown 骞跺箓绛夋竻鐞嗙洃鍚櫒", async () => {
+  const fakePage = new EventEmitter();
+  const observer = pwRunner.createSubmitResponseObserver(fakePage, {
+    pageUrl: "https://example.test/web/index.php?r=goods.edit&id=761",
+    expectedProductId: "761",
+    timeoutMs: 100,
+  });
+  assert.equal(fakePage.listenerCount("response"), 1);
+  fakePage.emit("response", {
+    url: () => "https://example.test/web/index.php?r=goods.edit&id=761",
+    request: () => ({ method: () => "POST" }),
+    status: () => 200,
+    headers: () => ({ "content-type": "application/json" }),
+    text: async () => { throw new Error("body unavailable"); },
+  });
+  const result = await observer.result;
+  assert.equal(result.status, "unknown");
+  assert.match(result.detail, /body_read_failed/);
+  observer.dispose();
+  observer.dispose();
+  assert.equal(fakePage.listenerCount("response"), 0);
+});
+
+test("createSubmitResponseObserver 閿佸畾棣栦釜璇锋眰骞跺拷鐣ュ悗缁笉鍚岃姹?, async () => {
+  const fakePage = new EventEmitter();
+  const timers = makeManualTimers();
+  const firstRequest = { method: () => "POST" };
+  const laterRequest = { method: () => "POST" };
+  const observer = pwRunner.createSubmitResponseObserver(fakePage, {
+    pageUrl: "https://example.test/web/index.php?r=goods.edit&id=761",
+    expectedProductId: "761",
+    timeoutMs: 100,
+    successGraceMs: 10,
+    timers: timers.api,
+  });
+  try {
+    fakePage.emit("response", fakeSubmitResponse('{"success":true}', { request: firstRequest }));
+    await new Promise(resolve => setImmediate(resolve));
+    fakePage.emit("response", fakeSubmitResponse('{"success":false,"message":"淇濆瓨澶辫触"}', { request: laterRequest }));
+    await new Promise(resolve => setImmediate(resolve));
+    timers.run(10);
+    assert.equal((await observer.result).status, "ok");
+  } finally {
+    observer.dispose();
+  }
+});
+
+test("createSubmitResponseObserver 鍦ㄧ煭 grace 鍚庡畬鎴愭樉寮忔垚鍔熻€岄潪绛夊緟鎬?deadline", async () => {
+  const fakePage = new EventEmitter();
+  const timers = makeManualTimers();
+  const observer = pwRunner.createSubmitResponseObserver(fakePage, {
+    pageUrl: "https://example.test/web/index.php?r=goods.edit&id=761",
+    expectedProductId: "761",
+    timeoutMs: 100,
+    successGraceMs: 10,
+    timers: timers.api,
+  });
+  try {
+    fakePage.emit("response", fakeSubmitResponse('{"status":1}'));
+    await new Promise(resolve => setImmediate(resolve));
+    assert.deepEqual(timers.activeDelays().sort((a, b) => a - b), [10, 100]);
+    timers.run(10);
+    const result = await observer.result;
+    assert.equal(result.status, "ok");
+    assert.equal(fakePage.listenerCount("response"), 0);
+  } finally {
+    observer.dispose();
+  }
+});
+
+test("createSubmitResponseObserver 蹇界暐 arm 鍓嶅搷搴斿苟鎺ュ彈 arm 鍚庡搷搴?, async () => {
+  const fakePage = new EventEmitter();
+  const timers = makeManualTimers();
+  const observer = pwRunner.createSubmitResponseObserver(fakePage, {
+    pageUrl: "https://example.test/web/index.php?r=goods.edit&id=761",
+    expectedProductId: "761",
+    timeoutMs: 100,
+    successGraceMs: 10,
+    timers: timers.api,
+    startArmed: false,
+  });
+  try {
+    fakePage.emit("response", fakeSubmitResponse('{"status":1}'));
+    await new Promise(resolve => setImmediate(resolve));
+    assert.deepEqual(timers.activeDelays(), [100]);
+    observer.arm();
+    fakePage.emit("response", fakeSubmitResponse('{"status":1}'));
+    await new Promise(resolve => setImmediate(resolve));
+    assert.ok(timers.activeDelays().includes(10));
+    timers.run(10);
+    assert.equal((await observer.result).status, "ok");
+  } finally {
+    observer.dispose();
+  }
+});
+
+test("createSubmitResponseObserver disarm 鍚庢姂鍒跺搷搴旂洿鍒?rearm", async () => {
+  const fakePage = new EventEmitter();
+  const timers = makeManualTimers();
+  const observer = pwRunner.createSubmitResponseObserver(fakePage, {
+    pageUrl: "https://example.test/web/index.php?r=goods.edit&id=761",
+    expectedProductId: "761",
+    timeoutMs: 100,
+    successGraceMs: 10,
+    timers: timers.api,
+    startArmed: false,
+  });
+  try {
+    observer.arm();
+    observer.disarm();
+    fakePage.emit("response", fakeSubmitResponse('{"status":1}'));
+    await new Promise(resolve => setImmediate(resolve));
+    assert.deepEqual(timers.activeDelays(), [100]);
+    observer.arm();
+    fakePage.emit("response", fakeSubmitResponse('{"status":1}'));
+    await new Promise(resolve => setImmediate(resolve));
+    timers.run(10);
+    assert.equal((await observer.result).status, "ok");
+  } finally {
+    observer.dispose();
+  }
+});
+
+test("createSubmitResponseObserver deadline 绛夊緟宸叉帴鏀跺搷搴旂殑 body 瑙ｆ瀽", async () => {
+  const fakePage = new EventEmitter();
+  const timers = makeManualTimers();
+  let resolveBody;
+  const body = new Promise(resolve => { resolveBody = resolve; });
+  const observer = pwRunner.createSubmitResponseObserver(fakePage, {
+    pageUrl: "https://example.test/web/index.php?r=goods.edit&id=761",
+    expectedProductId: "761",
+    timeoutMs: 100,
+    successGraceMs: 10,
+    bodyReadGraceMs: 20,
+    timers: timers.api,
+  });
+  let settled = false;
+  observer.result.then(() => { settled = true; });
+  try {
+    fakePage.emit("response", fakeSubmitResponse(body));
+    await new Promise(resolve => setImmediate(resolve));
+    timers.run(100);
+    await Promise.resolve();
+    assert.equal(settled, false);
+    assert.ok(timers.activeDelays().includes(20));
+    resolveBody('{"code":"1"}');
+    await new Promise(resolve => setImmediate(resolve));
+    const result = await observer.result;
+    assert.equal(result.status, "ok");
+  } finally {
+    observer.dispose();
+  }
+});
+
+test("createSubmitResponseObserver 棣栦釜鎹曡幏璇锋眰 body 鏈喅鏃朵繚鎸?unknown", async () => {
+  const fakePage = new EventEmitter();
+  const timers = makeManualTimers();
+  let resolvePendingBody;
+  const pendingBody = new Promise(resolve => { resolvePendingBody = resolve; });
+  const capturedRequest = { method: () => "POST" };
+  const laterRequest = { method: () => "POST" };
+  const observer = pwRunner.createSubmitResponseObserver(fakePage, {
+    pageUrl: "https://example.test/web/index.php?r=goods.edit&id=761",
+    expectedProductId: "761",
+    timeoutMs: 100,
+    successGraceMs: 10,
+    bodyReadGraceMs: 20,
+    timers: timers.api,
+  });
+  try {
+    fakePage.emit("response", fakeSubmitResponse(pendingBody, { request: capturedRequest }));
+    await new Promise(resolve => setImmediate(resolve));
+    fakePage.emit("response", fakeSubmitResponse('{"status":1}', { request: laterRequest }));
+    await new Promise(resolve => setImmediate(resolve));
+    timers.run(100);
+    timers.run(20);
+    const result = await observer.result;
+    assert.equal(result.status, "unknown");
+    assert.equal(result.detail, "body_read_timeout");
+  } finally {
+    resolvePendingBody('{"status":0}');
+    observer.dispose();
+  }
+});
+
+test("excludeBaselineToastCandidates 鎺掗櫎鐐瑰嚮鍓嶇浉鍚?selector 涓庢枃鏈?, () => {
+  const baseline = [
+    { selector: ".toast", text: "淇濆瓨鎴愬姛" },
+    { selector: ".message", text: "鏃ф秷鎭? },
+  ];
+  const current = [
+    { selector: ".toast", text: "淇濆瓨鎴愬姛" },
+    { selector: ".message", text: "淇濆瓨鎴愬姛" },
+  ];
+  assert.deepEqual(pwRunner.excludeBaselineToastCandidates(current, baseline), [
+    { selector: ".message", text: "淇濆瓨鎴愬姛" },
+  ]);
+});
+
+test("resolveSubmitByReadback 浠呯敤鎴愬姛涓旈€傜敤鐨勮鍥炶瘉鎹В鍐?unknown", () => {
+  const rawUnknown = { status: "unknown", detail: "no decisive signal" };
+  const resolved = batchRunner.resolveSubmitByReadback(rawUnknown, [
+    { scope: "fields", applicable: true, status: "ok" },
+    { scope: "vas", applicable: false, status: "skipped" },
+  ]);
+  assert.deepEqual(resolved, { status: "ok", resolvedBy: "readback", scopes: ["fields"] });
+  assert.equal(batchRunner.resolveSubmitByReadback(rawUnknown, []).status, "verify_failed");
+  assert.equal(batchRunner.resolveSubmitByReadback(rawUnknown, [{ scope: "images", applicable: true, status: "failed" }]).status, "verify_failed");
+  assert.equal(batchRunner.resolveSubmitByReadback({ status: "error" }, [{ scope: "fields", applicable: true, status: "ok" }]).status, "error");
+});
+
+test("normalizeSubmitCommandResult 灏?malformed daemon 杩斿洖闄嶇骇涓?unknown", () => {
+  for (const raw of ["bad response", null, { detail: "missing status" }]) {
+    const normalized = batchRunner.normalizeSubmitCommandResult(raw);
+    assert.equal(normalized.status, "unknown");
+    assert.equal(normalized.submitted, null);
+    assert.equal(normalized.sideEffectPossible, true);
+    assert.equal(normalized.retrySafe, false);
+    assert.equal(normalized.detail, "malformed_submit_response");
+    assert.ok(normalized.rawPreview.length <= 500);
+  }
+  assert.equal(batchRunner.normalizeSubmitCommandResult({ status: "ok", submitted: true }).status, "ok");
+});
+
+test("normalizeSubmitCommandResult redacts malformed raw preview secrets", () => {
+  const normalized = batchRunner.normalizeSubmitCommandResult({
+    code: 1,
+    message: "saved",
+    token: "raw-secret",
+    url: "https://example.test/save?api_key=query-secret&safe=kept",
+  });
+  assert.match(normalized.rawPreview, /saved/);
+  assert.match(normalized.rawPreview, /safe/);
+  assert.doesNotMatch(normalized.rawPreview, /raw-secret|query-secret/);
+  assert.ok(normalized.rawPreview.length <= 500);
+});
+
+test("buildSubmitTransportRecovery 灏?transport throw 鍥哄寲涓?submitting recovery", () => {
+  const recovered = batchRunner.buildSubmitTransportRecovery({
+    productId: 761,
+    status: "ok",
+    currentValues: { "1": { stock: "5" } },
+    expectedChanges: { "1": { stock: "6" } },
+    steps: [{ step: "apply", status: "ok" }],
+  }, new Error("connection reset"));
+  assert.equal(recovered.status, "verify_failed");
+  assert.equal(recovered.submitResult.status, "unknown");
+  assert.equal(recovered.submitResult.submitted, null);
+  assert.equal(recovered.recoveryRequired, true);
+  assert.equal(recovered.recoveryPhase, "submitting");
+  assert.equal(recovered.automaticResubmitBlocked, true);
+  assert.deepEqual(recovered.expectedChanges, { "1": { stock: "6" } });
+});
+
+test("evaluateImmediateFieldVerification 瀵规湁鏈熸湜浣嗛浂 checks 澶辫触鍏抽棴", () => {
+  const evaluation = batchRunner.evaluateImmediateFieldVerification({}, { stock: "6" });
+  assert.equal(evaluation.status, "failed");
+  assert.equal(evaluation.verifyResult.total, 1);
+  assert.equal(evaluation.verifyResult.mismatched, 1);
+});
+
+test("evaluateImmediateScopedVerification 瀵归€傜敤 image/VAS 涓ユ牸楠岃瘉 counts", () => {
+  const valid = batchRunner.evaluateImmediateScopedVerification({ status: "ok", verifyResult: { matched: 1, mismatched: 0, total: 1 } });
+  const zero = batchRunner.evaluateImmediateScopedVerification({ status: "ok", verifyResult: { matched: 0, mismatched: 0, total: 0 } });
+  const malformed = batchRunner.evaluateImmediateScopedVerification({ status: "ok", verifyResult: { matched: "1", mismatched: 0, total: 1 } });
+  const fractional = batchRunner.evaluateImmediateScopedVerification({ status: "ok", verifyResult: { matched: 0.5, mismatched: 0.5, total: 1 } });
+  const wrongTotal = batchRunner.evaluateImmediateScopedVerification({ status: "ok", verifyResult: { matched: 1, mismatched: 0, total: 2 } });
+  assert.equal(valid.status, "ok");
+  assert.equal(zero.status, "failed");
+  assert.equal(malformed.status, "failed");
+  assert.equal(fractional.status, "failed");
+  assert.equal(wrongTotal.status, "failed");
+});
+
+test("buildPostSubmitVerificationRecovery 淇濈暀鎻愪氦璇佹嵁骞堕樆姝㈣嚜鍔ㄩ噸鎻?, () => {
+  const recovered = batchRunner.buildPostSubmitVerificationRecovery({
+    productId: 761,
+    status: "ok",
+    submitResult: { status: "unknown", detail: "response_timeout", submitted: null },
+    currentValues: { "1": { stock: "5" } },
+    expectedChanges: { "1": { stock: "6" } },
+    steps: [{ step: "submit", status: "unknown" }],
+  }, new Error("readback connection reset"));
+  assert.equal(recovered.status, "verify_failed");
+  assert.equal(recovered.recoveryRequired, true);
+  assert.equal(recovered.recoveryPhase, "verification");
+  assert.equal(recovered.automaticResubmitBlocked, true);
+  assert.equal(recovered.submitResult.status, "unknown");
+});
+
+test("buildSubmitAuditSummary 鏆撮湶 raw unknown 涓?readback resolution", () => {
+  const summary = batchRunner.buildSubmitAuditSummary({
+    submitResult: { status: "unknown", detail: "response_timeout", submitted: null },
+    submitResolution: { status: "ok", resolvedBy: "readback", scopes: ["fields", "vas"] },
+  });
+  assert.deepEqual(summary, {
+    rawStatus: "unknown",
+    rawDetail: "response_timeout",
+    rawSubmitted: null,
+    resolutionStatus: "ok",
+    resolvedBy: "readback",
+    scopes: ["fields", "vas"],
+  });
+});
+
+test("buildSubmitAuditSummary 鍖呭惈鏈夌晫鍝嶅簲璇佹嵁浣嗕笉鍖呭惈鏁忔劅璇锋眰鏁版嵁", () => {
+  const summary = batchRunner.buildSubmitAuditSummary({
+    submitResult: {
+      status: "unknown",
+      response: { url: "https://example.test/save", httpStatus: 200, contentType: "application/json", bodyPreview: "x".repeat(700), requestBody: "secret", headers: { cookie: "secret" } },
+      rawPreview: "raw".repeat(300),
+    },
+  });
+  assert.equal(summary.responseEvidence.url, "https://example.test/save");
+  assert.equal(summary.responseEvidence.httpStatus, 200);
+  assert.ok(summary.responseEvidence.bodyPreview.length <= 500);
+  assert.ok(summary.responseEvidence.rawPreview.length <= 500);
+  assert.equal(summary.responseEvidence.requestBody, undefined);
+  assert.equal(summary.responseEvidence.headers, undefined);
+  const lines = batchRunner.buildSubmitAuditLines({ submitResult: { status: "unknown", response: { url: "https://example.test/save", httpStatus: 200, contentType: "application/json", bodyPreview: "{}" } } });
+  assert.ok(lines.some(line => /Submit response:/.test(line)));
+});
+
+test("buildSubmittedCheckpoint 淇濈暀 raw submit 涓庤鍥炴仮澶嶆墍闇€蹇収", () => {
+  const checkpoint = batchRunner.buildSubmittedCheckpoint({
+    productId: 761,
+    currentValues: { "1": { stock: "5" } },
+    expectedChanges: { "1": { stock: "6" } },
+    submitResult: { status: "unknown", detail: "response_timeout", submitted: null },
+    steps: [{ step: "submit", status: "unknown" }],
+  });
+  assert.equal(checkpoint.phase, "submitted");
+  assert.equal(checkpoint.productId, 761);
+  assert.equal(checkpoint.result.submitResult.status, "unknown");
+  assert.deepEqual(checkpoint.result.expectedChanges, { "1": { stock: "6" } });
+});
+
+test("buildSubmittingCheckpoint 鍦ㄥ彂閫佸墠淇濈暀鎵嬪伐鎭㈠鎵€闇€鐘舵€?, () => {
+  const checkpoint = batchRunner.buildSubmittingCheckpoint({
+    productId: 761,
+    currentValues: { "1": { stock: "5" } },
+    expectedChanges: { "1": { stock: "6" } },
+    imageBefore: { thumbs: { values: ["before.png"] } },
+    imageAfter: { thumbs: { values: ["after.png"] } },
+    vasBefore: { enabled: false, platforms: [], services: [] },
+    vasExpected: { enabled: true, platforms: ["wechat"], services: [] },
+    steps: [{ step: "apply", status: "ok" }],
+  });
+  assert.equal(checkpoint.phase, "submitting");
+  assert.equal(checkpoint.productId, 761);
+  assert.deepEqual(checkpoint.result.currentValues, { "1": { stock: "5" } });
+  assert.deepEqual(checkpoint.result.expectedChanges, { "1": { stock: "6" } });
+  assert.equal(checkpoint.result.submitResult, undefined);
+});
+
+test("prepareResumeState 闃绘 submitted checkpoint 鍟嗗搧鑷姩閲嶆彁骞朵繚鐣?recovery entry", () => {
+  const prepared = batchRunner.prepareResumeState({
+    status: "running",
+    spec: { items: [{ productId: 761 }, { productId: 762 }, { productId: 763 }] },
+    completed: [{ productId: 763, status: "ok" }],
+    previewOnly: [],
+    verifyFailed: [],
+    failed: [],
+    inFlight: {
+      productId: 761,
+      phase: "submitted",
+      result: {
+        productId: 761,
+        status: "ok",
+        currentValues: { "1": { stock: "5" } },
+        expectedChanges: { "1": { stock: "6" } },
+        submitResult: { status: "unknown", detail: "response_timeout", submitted: null },
+        steps: [{ step: "submit", status: "unknown" }],
+      },
+    },
+  });
+  assert.deepEqual(prepared.remainingItems.map(item => item.productId), [762]);
+  assert.equal(prepared.state.inFlight, null);
+  assert.equal(prepared.state.verifyFailed.length, 1);
+  assert.equal(prepared.state.verifyFailed[0].productId, 761);
+  assert.equal(prepared.state.verifyFailed[0].automaticResubmitBlocked, true);
+  assert.equal(prepared.state.verifyFailed[0].submitResult.status, "unknown");
+  assert.deepEqual(prepared.state.verifyFailed[0].expectedChanges, { "1": { stock: "6" } });
+});
+
+test("prepareResumeState 鍚屾牱闃绘 submitting checkpoint 鑷姩閲嶆彁", () => {
+  const prepared = batchRunner.prepareResumeState({
+    status: "running",
+    spec: { items: [{ productId: 761 }, { productId: 762 }] },
+    completed: [], previewOnly: [], verifyFailed: [], failed: [],
+    inFlight: {
+      productId: 761,
+      phase: "submitting",
+      result: {
+        productId: 761,
+        status: "ok",
+        currentValues: { "1": { stock: "5" } },
+        expectedChanges: { "1": { stock: "6" } },
+        steps: [{ step: "apply", status: "ok" }],
+      },
+    },
+  });
+  assert.deepEqual(prepared.remainingItems.map(item => item.productId), [762]);
+  assert.equal(prepared.state.verifyFailed[0].recoveryPhase, "submitting");
+  assert.equal(prepared.state.verifyFailed[0].automaticResubmitBlocked, true);
+  assert.equal(prepared.state.status, "recovery_required");
+});
+
+test("isResumableBatchState 鍜?selectLatestResumableBatchState 闃叉鍘熸壒娆￠噸鏀?, () => {
+  assert.equal(batchRunner.isResumableBatchState({ status: "resumed", resumedTo: "child" }), false);
+  assert.equal(batchRunner.isResumableBatchState({ status: "stopped" }), true);
+  assert.equal(batchRunner.isResumableBatchState({ status: "recovery_required" }), true);
+  const selected = batchRunner.selectLatestResumableBatchState([
+    { path: "original.json", mtimeMs: 30, state: { status: "resumed", resumedTo: "child" } },
+    { path: "child.json", mtimeMs: 20, state: { status: "stopped" } },
+  ]);
+  assert.equal(selected.path, "child.json");
+});
+
+test("writeJsonAtomic 鍘熷瓙鏇挎崲 JSON 涓斾笉閬楃暀涓存椂鏂囦欢", () => {
+  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rpa-atomic-"));
+  const file = path.join(dir, "state.json");
+  try {
+    batchRunner.writeJsonAtomic(file, { status: "first" });
+    batchRunner.writeJsonAtomic(file, { status: "second", values: [1, 2] });
+    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf-8")), { status: "second", values: [1, 2] });
+    assert.deepEqual(fs.readdirSync(dir), ["state.json"]);
+  } finally {
+    fs.rmSync(dir, { recursive: true, force: true });
+  }
+});
+
+test("getRollbackCandidates 涓?confirm 鎺掗櫎 legacy preview_only", () => {
+  const candidates = batchRunner.getRollbackCandidates({
+    completed: [{ productId: 761, status: "ok" }, { productId: 762, status: "preview_only" }],
+    verifyFailed: [{ productId: 763, status: "verify_failed" }],
+  });
+  assert.deepEqual(candidates.map(entry => entry.productId), [761, 763]);
+});
+
+test("buildRollbackExecutionPlan 鎺掗櫎 image-only 鏃犲揩鐓у€欓€?, () => {
+  const plan = batchRunner.buildRollbackExecutionPlan({
+    completed: [
+      { productId: 761, status: "ok", imageBefore: { thumbs: { values: ["a.png"] } }, imageAfter: { thumbs: { values: ["b.png"] } } },
+      { productId: 762, status: "ok", currentValues: { "1": { stock: "5" } }, finalValues: { "1": { stock: "6" } } },
+    ],
+    verifyFailed: [],
+  });
+  assert.deepEqual(plan.operations.map(operation => operation.entry.productId), [762]);
+  assert.equal(plan.items.length, 1);
+});
+
+test("evaluateRollbackVerification 瑕佹眰闈為浂瀛楁鎴栦弗鏍?VAS 璇佹嵁", () => {
+  const noEvidence = batchRunner.evaluateRollbackVerification({ currentValues: {}, expectedFields: {}, vasApplicable: false });
+  const zeroVAS = batchRunner.evaluateRollbackVerification({
+    currentValues: {}, expectedFields: {}, vasApplicable: true,
+    vasResult: { status: "ok", verifyResult: { matched: 0, mismatched: 0, total: 0 } },
+  });
+  const malformedVAS = batchRunner.evaluateRollbackVerification({
+    currentValues: {}, expectedFields: {}, vasApplicable: true,
+    vasResult: { status: "ok", verifyResult: {} },
+  });
+  const fieldsOk = batchRunner.evaluateRollbackVerification({ currentValues: { "1": { stock: "5" } }, expectedFields: { "1": { stock: "5" } }, vasApplicable: false });
+  assert.equal(noEvidence.status, "error");
+  assert.equal(zeroVAS.status, "error");
+  assert.equal(malformedVAS.status, "error");
+  assert.equal(fieldsOk.status, "verified");
+  assert.ok(fieldsOk.total > 0);
+});
+
+test("buildMirrorWritebackPayload 浣跨敤 saas_verify 涓庨獙璇佹椂闂?, () => {
+  const payload = mirrorSearch.buildMirrorWritebackPayload(761, [{ SKU: "A", fields: { 搴撳瓨: "6" } }], "2026-07-10T10:00:00.000Z");
+  assert.deepEqual(payload, {
+    goods_id: 761,
+    sku_updates: [{ SKU: "A", fields: { 搴撳瓨: "6" } }],
+    source: "saas_verify",
+    verified_at: "2026-07-10T10:00:00.000Z",
+  });
+});
+
+test("resolveVerifiedWritebackTimestamp 瑕佹眰鐪熷疄鏈夋晥 delayedVerify.at", () => {
+  assert.equal(mirrorSearch.resolveVerifiedWritebackTimestamp({ status: "delayed_verified" }).ok, false);
+  assert.equal(mirrorSearch.resolveVerifiedWritebackTimestamp({ status: "delayed_verified", delayedVerify: { at: "not-a-date" } }).ok, false);
+  assert.deepEqual(mirrorSearch.resolveVerifiedWritebackTimestamp({ status: "delayed_verified", delayedVerify: { at: "2026-07-10T10:00:00.000Z" } }), {
+    ok: true,
+    verificationAt: "2026-07-10T10:00:00.000Z",
+  });
+});
+
+test("buildMirrorFieldUpdates 瀹屾暣鏄犲皠 dynamic rent 涓旀嫆缁濇湭鐭ュ瓧娈?, () => {
+  assert.deepEqual(mirrorSearch.buildMirrorFieldUpdates({ stock: "6", rent45day: "120.00" }), {
+    ok: true,
+    skuFields: { 搴撳瓨: "6", "45澶╃閲?: "120.00" },
+    unmappedFields: [],
+  });
+  const rejected = mirrorSearch.buildMirrorFieldUpdates({ stock: "6", mysteryField: "x" });
+  assert.equal(rejected.ok, false);
+  assert.deepEqual(rejected.unmappedFields, ["mysteryField"]);
+  assert.deepEqual(rejected.skuFields, {});
+});
+
+test("evaluateDelayedVerification 瀵?read 閿欒鍜屾湁鏈熸湜浣嗛浂 checks 澶辫触鍏抽棴", () => {
+  const readError = batchRunner.evaluateDelayedVerification({
+    readResult: { status: "error", message: "read failed" },
+    expectedChanges: { stock: "6" },
+    imageApplicable: false,
+    vasApplicable: false,
+  });
+  assert.equal(readError.status, "error");
+  assert.ok(readError.failed > 0);
+
+  const zeroChecks = batchRunner.evaluateDelayedVerification({
+    readResult: { status: "ok", values: {} },
+    expectedChanges: { stock: "6" },
+    imageApplicable: false,
+    vasApplicable: false,
+  });
+  assert.equal(zeroChecks.status, "error");
+  assert.ok(zeroChecks.failed > 0);
+});
+
+test("evaluateDelayedVerification 瀵归€傜敤浣嗙己澶辩粨鏋滅殑鍥剧墖楠岃瘉澶辫触鍏抽棴", () => {
+  const imageError = batchRunner.evaluateDelayedVerification({
+    readResult: { status: "ok", values: { "1": {} } },
+    expectedChanges: {},
+    imageApplicable: true,
+    imageResult: { status: "error", message: "image verify failed" },
+    vasApplicable: false,
+  });
+  const imageMissingResult = batchRunner.evaluateDelayedVerification({
+    readResult: { status: "ok", values: { "1": {} } },
+    expectedChanges: {},
+    imageApplicable: true,
+    imageResult: { status: "ok" },
+    vasApplicable: false,
+  });
+  assert.equal(imageError.status, "error");
+  assert.ok(imageError.failed > 0);
+  assert.equal(imageMissingResult.status, "error");
+  assert.ok(imageMissingResult.failed > 0);
+});
+
+test("evaluateDelayedVerification 鎷掔粷绌烘垨闈炴暟瀛?image/VAS verifyResult", () => {
+  const malformedImage = batchRunner.evaluateDelayedVerification({
+    readResult: { status: "ok", values: { "1": {} } }, expectedChanges: {},
+    imageApplicable: true, imageResult: { status: "ok", verifyResult: {} }, vasApplicable: false,
+  });
+  const malformedVAS = batchRunner.evaluateDelayedVerification({
+    readResult: { status: "ok", values: { "1": {} } }, expectedChanges: {}, imageApplicable: false,
+    vasApplicable: true, vasResult: { status: "ok", verifyResult: { matched: "1", mismatched: -1, total: "0" } },
+  });
+  assert.equal(malformedImage.status, "error");
+  assert.ok(malformedImage.failed > 0);
+  assert.equal(malformedVAS.status, "error");
+  assert.ok(malformedVAS.failed > 0);
+});
+
+test("evaluateDelayedVerification 鎷掔粷 fractional 鍜?total 涓嶇瓑浜庤鏁板拰", () => {
+  const greaterTotal = batchRunner.evaluateDelayedVerification({
+    readResult: { status: "ok", values: { "1": {} } }, expectedChanges: {}, imageApplicable: true,
+    imageResult: { status: "ok", verifyResult: { matched: 1, mismatched: 0, total: 2 } }, vasApplicable: false,
+  });
+  const fractional = batchRunner.evaluateDelayedVerification({
+    readResult: { status: "ok", values: { "1": {} } }, expectedChanges: {}, imageApplicable: false, vasApplicable: true,
+    vasResult: { status: "ok", verifyResult: { matched: 0.5, mismatched: 0.5, total: 1 } },
+  });
+  assert.equal(greaterTotal.status, "error");
+  assert.equal(fractional.status, "error");
+});
+
+test("evaluateDelayedVerification 鎷掔粷閫傜敤 image/VAS 鐨?0/0 counts", () => {
+  const zeroImage = batchRunner.evaluateDelayedVerification({
+    readResult: { status: "ok", values: { "1": {} } }, expectedChanges: {}, imageApplicable: true,
+    imageResult: { status: "ok", verifyResult: { matched: 0, mismatched: 0, total: 0 } }, vasApplicable: false,
+  });
+  const zeroVAS = batchRunner.evaluateDelayedVerification({
+    readResult: { status: "ok", values: { "1": {} } }, expectedChanges: {}, imageApplicable: false, vasApplicable: true,
+    vasResult: { status: "ok", verifyResult: { matched: 0, mismatched: 0, total: 0 } },
+  });
+  assert.equal(zeroImage.status, "error");
+  assert.equal(zeroVAS.status, "error");
+});
+
+test("evaluateDelayedVerification 瀵?setup-only 闆舵鏌ュけ璐ュ叧闂?, () => {
+  const evaluation = batchRunner.evaluateDelayedVerification({
+    readResult: { status: "ok", values: { "1": {} } },
+    expectedChanges: {}, imageApplicable: false, vasApplicable: false, requireAnyCheck: true,
+  });
+  assert.equal(evaluation.status, "error");
+  assert.ok(evaluation.failed > 0);
+});
+
+test("deriveDelayedStateStatus 涓嶅湪浠嶆湁 unresolved entries 鏃舵爣璁?delayed_verified", () => {
+  const verified = [{ productId: 761, status: "verified" }];
+  assert.equal(batchRunner.deriveDelayedStateStatus(verified, 0), "delayed_verified");
+  assert.equal(batchRunner.deriveDelayedStateStatus(verified, 1), "delayed_verify_partial");
+  assert.equal(batchRunner.deriveDelayedStateStatus([{ productId: 761, status: "error" }], 0), "delayed_verify_partial");
+});
+
+test("countDelayedUnresolved 鍖呭惈 submitting/submitted inFlight 涓斾笉閲嶅璁℃暟", () => {
+  assert.equal(batchRunner.countDelayedUnresolved({ verifyFailed: [{ productId: 761 }], inFlight: { productId: 761, phase: "submitted" } }), 1);
+  assert.equal(batchRunner.countDelayedUnresolved({ verifyFailed: [{ productId: 761 }], inFlight: { productId: 762, phase: "submitting" } }), 2);
+  assert.equal(batchRunner.countDelayedUnresolved({ verifyFailed: [], inFlight: { productId: 762, phase: "reading" } }), 0);
+  assert.equal(batchRunner.countDelayedUnresolved({ verifyFailed: [], failed: [{ productId: 763, recoveryRequired: true }], inFlight: null }), 1);
+});
+
+test("deriveBatchFinalStatus 浼樺厛 recovery_required", () => {
+  assert.equal(batchRunner.deriveBatchFinalStatus({ verifyFailed: [{ productId: 761, recoveryRequired: true }], failed: [] }, false), "recovery_required");
+  assert.equal(batchRunner.deriveBatchFinalStatus({ verifyFailed: [], failed: [{ productId: 761, automaticResubmitBlocked: true }] }, true), "recovery_required");
+  assert.equal(batchRunner.deriveBatchFinalStatus({ verifyFailed: [{ productId: 761 }], failed: [] }, false), "completed_with_mismatch");
+});
+
+test("buildSubmitAuditLines 涓?failed 鏉＄洰鍛堢幇 raw 涓?resolution", () => {
+  const lines = batchRunner.buildSubmitAuditLines({
+    submitResult: { status: "unknown", detail: "click timeout", submitted: null },
+    submitResolution: { status: "verify_failed", resolvedBy: "readback", scopes: ["fields"] },
+  }, "    ");
+  assert.ok(lines.some(line => /Submit raw: status=unknown/.test(line)));
+  assert.ok(lines.some(line => /detail=click timeout/.test(line)));
+  assert.ok(lines.some(line => /Submit resolution: status=verify_failed/.test(line)));
+});
+
+test("buildVerificationAuditLines 鍛堢幇 field/image/VAS/recovery 鐘舵€?, () => {
+  const lines = batchRunner.buildVerificationAuditLines({
+    verifyResult: { matched: 1, mismatched: 1, total: 2, mismatches: [{ specId: "1", field: "stock", expected: "6", actual: "5" }] },
+    imageVerifyResult: { status: "mismatch", verifyResult: { matched: 2, mismatched: 1, total: 3 } },
+    vasVerifyResult: { status: "ok", verifyResult: { matched: 4, mismatched: 0, total: 4 } },
+    recoveryRequired: true,
+    recoveryPhase: "submitting",
+    recoveryMessage: "manual verification required",
+  }, "  ");
+  assert.ok(lines.some(line => /Field verify: 1\/2/.test(line)));
+  assert.ok(lines.some(line => /Image verify: status=mismatch, 2\/3/.test(line)));
+  assert.ok(lines.some(line => /VAS verify: status=ok, 4\/4/.test(line)));
+  assert.ok(lines.some(line => /Recovery: phase=submitting/.test(line)));
+});
+
+test("buildLegacyApplySubmitDecision 浠呭厑璁?apply ok 鍚?submit", () => {
+  assert.deepEqual(pwRunner.buildLegacyApplySubmitDecision({ status: "ok" }, true), { shouldSubmit: true, submitResult: null });
+  assert.deepEqual(pwRunner.buildLegacyApplySubmitDecision({ status: "partial" }, true), {
+    shouldSubmit: false,
+    submitResult: { status: "skipped", reason: "apply_status_not_ok", applyStatus: "partial" },
+  });
+  assert.equal(pwRunner.buildLegacyApplySubmitDecision({ status: "error" }, true).shouldSubmit, false);
+  assert.deepEqual(pwRunner.buildLegacyApplySubmitDecision({ status: "ok" }, false), { shouldSubmit: false, submitResult: null });
+});
+
+test("dispatchSubmitClick 鎸?trial -> arm -> force 椤哄簭鎵ц", async () => {
+  const calls = [];
+  const element = { async click(options) { calls.push(options.trial ? "trial" : (options.force ? "force" : "plain")); } };
+  const observer = { arm() { calls.push("arm"); } };
+  await pwRunner.dispatchSubmitClick(element, observer);
+  assert.deepEqual(calls, ["trial", "arm", "force"]);
+
+  const failureCalls = [];
+  const failingElement = { async click(options) { failureCalls.push(options.trial ? "trial" : "force"); throw new Error("trial blocked"); } };
+  const untouchedObserver = { arm() { failureCalls.push("arm"); } };
+  await assert.rejects(() => pwRunner.dispatchSubmitClick(failingElement, untouchedObserver), /trial blocked/);
+  assert.deepEqual(failureCalls, ["trial"]);
+});
+
+test("mergeLegacyApplySubmitOutcome 浼犳挱 nested submit 鍒?top-level status", () => {
+  const apply = { status: "ok", appliedCount: 2 };
+  const unknown = pwRunner.mergeLegacyApplySubmitOutcome(apply, { status: "unknown", submitted: null, sideEffectPossible: true, retrySafe: false });
+  const error = pwRunner.mergeLegacyApplySubmitOutcome(apply, { status: "error", message: "save failed" });
+  const ok = pwRunner.mergeLegacyApplySubmitOutcome(apply, { status: "ok", submitted: true });
+  assert.equal(unknown.status, "unknown");
+  assert.equal(unknown.sideEffectPossible, true);
+  assert.equal(unknown.retrySafe, false);
+  assert.equal(unknown.submit.status, "unknown");
+  assert.equal(unknown.appliedCount, 2);
+  assert.equal(error.status, "error");
+  assert.equal(error.submit.status, "error");
+  assert.equal(ok.status, "ok");
+});
+
+test("compareLegacyVerification 鏀寔 nested 涓?flat锛屽苟瀵圭己澶?read 閿欒澶辫触", () => {
+  const read = { status: "ok", values: { "1": { stock: "6", rent1day: "10" }, "2": { stock: "6", rent1day: "20" } } };
+  const nested = pwRunner.compareLegacyVerification(read, { "1": { stock: "6" }, "2": { rent1day: "20" } });
+  const flat = pwRunner.compareLegacyVerification(read, { stock: "6" });
+  const missing = pwRunner.compareLegacyVerification(read, { "3": { stock: "6" }, "1": { deposit: "100" } });
+  const readError = pwRunner.compareLegacyVerification({ status: "error", message: "read failed" }, { stock: "6" });
+  assert.equal(nested.status, "ok");
+  assert.equal(nested.matches["1"].stock, true);
+  assert.equal(flat.status, "ok");
+  assert.equal(flat.matches["2"].stock, true);
+  assert.equal(missing.status, "mismatch");
+  assert.ok(missing.mismatches.some(item => item.specId === "3"));
+  assert.ok(missing.mismatches.some(item => item.field === "deposit"));
+  assert.equal(readError.status, "error");
+});
+
+test("filterPlatformProducts 杩囨护 MQ 涓庨摼鎺ヤ环鍟嗗搧", () => {
+  const rows = [
+    { id: "1", name: "MQ-涓撲汉缁存姢", cells: ["MQ-涓撲汉缁存姢", "100"], text: "MQ-涓撲汉缁存姢 | 100" },
+    { id: "2", name: "鏅€氬晢鍝?, cells: ["鏅€氬晢鍝?, "0.01"], text: "鏅€氬晢鍝?| 0.01" },
+    { id: "3", name: "姝ｅ父鍟嗗搧", cells: ["姝ｅ父鍟嗗搧", "199"], text: "姝ｅ父鍟嗗搧 | 199" },
+  ];
+  const result = pwRunner.filterPlatformProducts(rows);
+  assert.deepEqual(result.products.map(x => x.id), ["3"]);
+  assert.deepEqual(result.excluded.map(x => x.reason), ["mq-maintained", "link-price"]);
+});
+
+test("filterSearchDetails 杩囨护 mirror 涓?MQ 涓庨摼鎺ヤ环鍟嗗搧", () => {
+  const products = [
+    { id: 1, name: "MQ-缁存姢", skus: [{ "1澶╃閲?: "199" }] },
+    { id: 2, name: "鏅€氬晢鍝?, skus: [{ "1澶╃閲?: "0.01" }] },
+    { id: 3, name: "姝ｅ父鍟嗗搧", skus: [{ "1澶╃閲?: "299" }] },
+  ];
+  const result = mirrorSearch.filterSearchDetails(products);
+  assert.deepEqual(result.items.map(x => x.id), [3]);
+  assert.deepEqual(result.excluded.map(x => x.reason), ["mq-maintained", "link-price"]);
+});
+
+test("readProductOnTab 鍦?explicitFields 涓嬫妸缂哄け鍏冪礌鏍囨垚 partial", async () => {
+  pwRunner.__setConfigForTest({
+    saas: { productDetailUrl: "https://example.test/web/index.php?r=goods.edit&id={productId}" },
+    selectors: { product: { rent1day: "input.option_rent1day_{specId}", rent10day: "input.option_rent10day_{specId}" } },
+  });
+  const tab = makeFakeTab({
+    specs: [{ specId: "3862", title: "榛樿瑙勬牸" }],
+    rentFields: { "3862": {} },
+    elements: {
+      "input.option_rent1day_3862": { value: "22.00", tag: "input" },
+    },
+  });
+  const result = await pwRunner.readProductOnTab(tab, "761", ["rent1day", "rent10day"], true);
+  assert.equal(result.status, "partial");
+  assert.equal(result.readCount, 1);
+  assert.equal(result.missingFields.length, 1);
+  assert.equal(result.missingFields[0].field, "rent10day");
+});
+
+test("readProductOnTab rejects a redirect to a different product before reading specs", async () => {
+  pwRunner.__setConfigForTest({
+    saas: { productDetailUrl: "https://example.test/web/index.php?r=goods.edit&id={productId}" },
+    selectors: { product: {} },
+  });
+  const tab = makeFakeTab({
+    redirectUrl: "https://example.test/web/index.php?r=goods.edit&id=762",
+    specs: [{ specId: "3862", title: "wrong product" }],
+  });
+  await assert.rejects(
+    () => pwRunner.readProductOnTab(tab, "761", [], true),
+    /Current page product mismatch/
+  );
+});
+
+test("readProductOnTab 鍦?explicitFields 涓斿叏閮ㄧ己澶辨椂杩斿洖 error", async () => {
+  pwRunner.__setConfigForTest({
+    saas: { productDetailUrl: "https://example.test/web/index.php?r=goods.edit&id={productId}" },
+    selectors: { product: { rent1day: "input.option_rent1day_{specId}" } },
+  });
+  const tab = makeFakeTab({
+    specs: [{ specId: "3862", title: "榛樿瑙勬牸" }],
+    rentFields: { "3862": {} },
+    elements: {},
+  });
+  const result = await pwRunner.readProductOnTab(tab, "761", ["rent1day"], true);
+  assert.equal(result.status, "error");
+  assert.equal(result.readCount, 0);
+  assert.equal(result.missingFields.length, 1);
+});
+
+test("readProductOnTab 鍦ㄩ潪 explicitFields 涓嬩繚鐣?warn 浣嗕笉闄嶄负 partial", async () => {
+  pwRunner.__setConfigForTest({
+    saas: { productDetailUrl: "https://example.test/web/index.php?r=goods.edit&id={productId}" },
+    selectors: { product: { rent1day: "input.option_rent1day_{specId}" } },
+  });
+  const tab = makeFakeTab({
+    specs: [{ specId: "3862", title: "榛樿瑙勬牸" }],
+    rentFields: { "3862": {} },
+    elements: {},
+  });
+  const result = await pwRunner.readProductOnTab(tab, "761", ["rent1day"], false);
+  assert.equal(result.status, "ok");
+  assert.equal(result.warnings.length, 1);
+  assert.equal(result.missingFields.length, 0);
+});
+
+test("椤圭洰娴嬭瘯 spec 浠呭厑璁?761", () => {
+  const tasksDir = path.resolve(__dirname, "../tasks");
+  const targets = [
+    path.join(tasksDir, "test1_uniform.json"),
+    path.join(tasksDir, "test2_diff.json"),
+    path.join(tasksDir, "test3_tenancy.json"),
+  ];
+  for (const file of targets) {
+    const json = JSON.parse(fs.readFileSync(file, "utf-8"));
+    const ids = (json.items || []).map(item => String(item.productId));
+    assert.ok(ids.every(id => id === "761"), path.basename(file) + " should only target product 761");
+  }
+});
+
+test("娲昏穬绀轰緥鍟嗗搧 ID 鍙娇鐢?761", () => {
+  const targets = [
+    path.resolve(__dirname, "../SKILL.md"),
+    path.resolve(__dirname, "./batch-runner.js"),
+    path.resolve(__dirname, "../README.md"),
+  ];
+  assert.equal(extractActiveExampleText("live product 653 safety limit", ".md").includes("653"), false);
+  assert.equal(extractActiveExampleText("prose 653\n```json\n{\"productId\":762}\n```", ".md").includes("762"), true);
+  for (const file of targets) {
+    const text = fs.readFileSync(file, "utf-8");
+    const activeText = extractActiveExampleText(text, path.extname(file).toLowerCase());
+    const ids = [...activeText.matchAll(/\b(?:653|76[123])\b/g)].map(match => match[0]);
+    assert.ok(ids.every(id => id === "761"), path.basename(file) + " active examples should only use product 761, got: " + ids.join(","));
+  }
+});
+
+// --- Dynamic rent field tests ---
+
+test("config 鍖呭惈 _dynamicFields.rentDays 鍙戠幇瑙勫垯", () => {
+  const configPath = path.resolve(__dirname, "../config.json");
+  const cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
+  const df = cfg.selectors && cfg.selectors.product && cfg.selectors.product._dynamicFields;
+  assert.ok(df && df.rentDays, "config.selectors.product._dynamicFields.rentDays must exist");
+  const r = df.rentDays;
+  assert.ok(r.scanSelector, "rentDays.scanSelector must exist");
+  assert.ok(r.extractDaysRegex, "rentDays.extractDaysRegex must exist");
+  assert.ok(r.selectorTemplate, "rentDays.selectorTemplate must exist");
+  assert.ok(r.fieldTemplate, "rentDays.fieldTemplate must exist");
+});
+
+test("config 涓嶅啀鍖呭惈闈欐€?rent1day/rent10day/rent30day selector", () => {
+  const configPath = path.resolve(__dirname, "../config.json");
+  const cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
+  const product = cfg.selectors && cfg.selectors.product;
+  assert.equal(product.rent1day, undefined, "rent1day should be removed (now dynamic)");
+  assert.equal(product.rent10day, undefined, "rent10day should be removed (now dynamic)");
+  assert.equal(product.rent30day, undefined, "rent30day should be removed (now dynamic)");
+});
+
+test("isDynamicRentField 璇嗗埆 rent{N}day 鏍煎紡", () => {
+  assert.equal(pwRunner.isDynamicRentField("rent1day"), true);
+  assert.equal(pwRunner.isDynamicRentField("rent30day"), true);
+  assert.equal(pwRunner.isDynamicRentField("rent180day"), true);
+  assert.equal(pwRunner.isDynamicRentField("rent45day"), true);
+  assert.equal(pwRunner.isDynamicRentField("stock"), false);
+  assert.equal(pwRunner.isDynamicRentField("marketPrice"), false);
+  assert.equal(pwRunner.isDynamicRentField("rentday"), false);
+});
+
+test("resolveDynamicRentSelector 浠庢ā鏉跨敓鎴?selector", () => {
+  pwRunner.__setConfigForTest({
+    selectors: {
+      product: {
+        _dynamicFields: {
+          rentDays: {
+            selectorTemplate: "input.option_rent{days}day_{specId}",
+            extractDaysRegex: "option_rent(\\d+)day",
+            fieldTemplate: "rent{days}day",
+            scanSelector: "input[class*='option_rent'][class*='day']",
+          }
+        }
+      }
+    }
+  });
+  assert.equal(
+    pwRunner.resolveDynamicRentSelector("rent5day", "3862"),
+    "input.option_rent5day_3862"
+  );
+  assert.equal(
+    pwRunner.resolveDynamicRentSelector("rent180day", "9999"),
+    "input.option_rent180day_9999"
+  );
+  assert.equal(
+    pwRunner.resolveDynamicRentSelector("stock", "3862"),
+    null
+  );
+});
+
+test("resolveFieldSelector 浼樺厛鐢ㄩ潤鎬侀厤缃紝鍔ㄦ€?fallback 绉熸湡瀛楁", () => {
+  pwRunner.__setConfigForTest({
+    selectors: {
+      product: {
+        stock: "input.option_stock_{specId}",
+        _dynamicFields: {
+          rentDays: {
+            selectorTemplate: "input.option_rent{days}day_{specId}",
+            extractDaysRegex: "option_rent(\\d+)day",
+            fieldTemplate: "rent{days}day",
+            scanSelector: "input[class*='option_rent'][class*='day']",
+          }
+        }
+      }
+    }
+  });
+  // Static field
+  assert.equal(
+    pwRunner.resolveFieldSelector("stock", "3862"),
+    "input.option_stock_3862"
+  );
+  // Dynamic rent field
+  assert.equal(
+    pwRunner.resolveFieldSelector("rent7day", "3862"),
+    "input.option_rent7day_3862"
+  );
+  assert.equal(
+    pwRunner.resolveFieldSelector("rent180day", "3862"),
+    "input.option_rent180day_3862"
+  );
+  // Unknown field
+  assert.equal(
+    pwRunner.resolveFieldSelector("unknownField", "3862"),
+    null
+  );
+});
+
+test("skuToFieldName 鍔ㄦ€?fallback 鍖归厤浠绘剰 N澶╃閲?, () => {
+  // Known mappings still work
+  assert.equal(mirrorSearch.skuToFieldName("1澶╃閲?), "rent1day");
+  assert.equal(mirrorSearch.skuToFieldName("30澶╃閲?), "rent30day");
+  assert.equal(mirrorSearch.skuToFieldName("搴撳瓨"), "stock");
+  // Dynamic fallback for arbitrary periods
+  assert.equal(mirrorSearch.skuToFieldName("45澶╃閲?), "rent45day");
+  assert.equal(mirrorSearch.skuToFieldName("120澶╃閲?), "rent120day");
+  assert.equal(mirrorSearch.skuToFieldName("365澶╃閲?), "rent365day");
+  // Non-rent fields still return null
+  assert.equal(mirrorSearch.skuToFieldName("鏈煡瀛楁"), null);
+});
+
+test("readProductOnTab 闈?explicitFields 鏃惰嚜鍔ㄥ彂鐜板姩鎬佺鏈熷瓧娈?, async () => {
+  pwRunner.__setConfigForTest({
+    saas: { productDetailUrl: "https://example.test/web/index.php?r=goods.edit&id={productId}" },
+    selectors: {
+      product: {
+        stock: "input.option_stock_{specId}",
+        _dynamicFields: {
+          rentDays: {
+            selectorTemplate: "input.option_rent{days}day_{specId}",
+            extractDaysRegex: "option_rent(\\d+)day",
+            fieldTemplate: "rent{days}day",
+            scanSelector: "input[class*='option_rent'][class*='day']",
+          }
+        }
+      }
+    }
+  });
+  const tab = makeFakeTab({
+    specs: [{ specId: "3862", title: "榛樿瑙勬牸" }],
+    rentFields: { "3862": { rent1day: 1, rent5day: 5, rent30day: 30 } },
+    elements: {
+      "input.option_stock_3862": { value: "10", tag: "input" },
+      "input.option_rent1day_3862": { value: "22.00", tag: "input" },
+      "input.option_rent5day_3862": { value: "88.00", tag: "input" },
+      "input.option_rent30day_3862": { value: "300.00", tag: "input" },
+    },
+  });
+  // Pass static fields (simulating actionBatchRead which resolves getProductFields()), explicitFields=false
+  const result = await pwRunner.readProductOnTab(tab, "761", ["stock"], false);
+  assert.equal(result.status, "ok");
+  const vals = result.values["3862"];
+  assert.equal(vals.stock, "10");
+  assert.equal(vals.rent1day, "22.00");
+  assert.equal(vals.rent5day, "88.00");
+  assert.equal(vals.rent30day, "300.00");
+  // Should have discovered 3 rent fields
+  assert.equal(Object.keys(result.dynamicRentFields["3862"]).length, 3);
+});
+
+(async () => {
+  let passed = 0;
+  for (const item of tests) {
+    try {
+      await item.fn();
+      process.stdout.write("[PASS] " + item.name + "\n");
+      passed++;
+    } catch (err) {
+      process.stderr.write("[FAIL] " + item.name + "\n");
+      process.stderr.write(String(err && err.stack ? err.stack : err) + "\n");
+      process.exitCode = 1;
+    }
+  }
+  process.stdout.write("\n" + passed + "/" + tests.length + " tests passed\n");
+  if (process.exitCode) process.exit(process.exitCode);
+})();

---

## MT-agent 新版 rental skill 接入调研（2026-07-15）

### 调研范围

- 旧版接入基线：`C:\works\MT-agent\vendor\rental-price-agent` 与 MT 侧 `src/feishuBot/rentalPrice.ts`、`src/agentRuntime/toolRegistry.ts`、`src/feishuBot/rentalBatchHandlers.ts`、`src/feishuBot/rentalWriteOperationHandlers.ts`。
- 新版 demo 快照：`C:\works\rental-price-agent-new`。
- 调研方式：静态代码/文档审计、`rg` 搜索调用面、主脚本 `node --check` 语法检查；未启动 daemon，未访问真实 SaaS，未安装 demo 依赖。

### 总体结论

新版 demo 快照与本 diff 报告中的新版协议高度一致，属于旧版 rental-price-skill 工具解耦和安全收口后的快照，而不是完全不同的新协议。核心 daemon action、batch runner、mirror search、task-store、diff-generator 等入口仍保留，因此具备接入可行性。

当前不能直接无脑替换，主要原因是新版 `submit` 协议收紧：daemon `submit` 必须带 `expectedProductId` 并验证当前 canonical 商品编辑页。MT 当前适配层仍有多处发送 `{ action: 'submit' }`，正式接入前必须修复并补测试。

### MT 当前接入面

| 接入面 | 当前作用 | 新版接入关注点 |
|---|---|---|
| `RentalPriceSkillClient` | MT 侧主要 daemon 适配边界，封装 read/apply/submit/copy/delist/spec/rollback 等 | 所有 `submit` 调用补 `expectedProductId`；保留 unknown/sideEffect/retrySafe 语义 |
| `toolRegistry.ts` | 暴露 `rental.*` 工具 schema、risk、confirmation、plannerVisible | 新增图片/VAS 前必须补 schema、确认卡和测试；不要直接让 planner 调底层 action |
| `rentalBatchHandlers.ts` | 直接调用 `batch-runner.js`，处理 preview/execute/status/resume/report/rollback | `batchExecute` 需补 `confirmImageWithoutPreview` 才能安全接图片 batch |
| `rentalMirrorHandlers.ts` | 直接调用 `mirror-search.js` 的 search/batch-spec | mirror writeback 仍不应直接开放；新版写回要求 delayedVerify.at |
| `daemonCatalog.ts` | 直接调用 daemon/CLI `platform-search-all` 刷新链接档案候选 | 新版仍支持；注意 protected-product 过滤会影响候选 |
| 飞书确认卡 | 人类审批控制面 | 只承载摘要、风险、确认/取消和报告，不承载完整计划状态 |

### 兼容与非兼容服务

| 服务/能力 | 新版变化 | MT 接入判断 |
|---|---|---|
| `read` / `apply` | 签名基本不变 | 兼容 |
| `submit` | 新增必填 `expectedProductId`，校验商品编辑页 | 阻断项，必须适配 |
| `apply-current` | 要求 `allowCurrentPage=true` 与 `expectedProductId` | MT 基本符合，需回归 |
| legacy `verify` | 从 `verify <productId>` 变为 `verify <productId> <changes.json>` | 新代码不要用旧形态 |
| `copy` / `delist` | action 保留，unknown/sideEffect 语义更明确 | 基本兼容，需保守处理 unknown |
| `spec-*` / `tenancy-set` | action 保留，current-page 保护更严格 | 基本兼容，结构变更后不要重新导航 read |
| batch `execute` | form setup 仍需 `confirmFormSetupWithoutPreview`，图片还需 `confirmImageWithoutPreview` | 字段/setup 兼容；图片需扩展 MT schema |
| delayed-verify | 手动触发，fail-closed，覆盖字段/图片/VAS | 需调整工作流和报告预期 |
| rollback | 字段/VAS rollback；图片/spec/tenancy 不支持 | 需在卡片/报告中明确边界 |
| config rent fields | 固定 selector 改为 `_dynamicFields.rentDays` | 真实配置需迁移 |
| 图片管理 | 新增 image-read/upload/pick/order/verify/white-image | 不建议第一阶段开放给 planner |
| VAS | 新增 vas-read/catalog/apply/verify | 不建议第一阶段开放给 planner |

### 改价、规格、租期相关更新

| 模块 | 新版更新 | 对 MT 的意义 |
|---|---|---|
| 普通改价 | 仍是 read -> diff -> apply -> submit -> readback，但 submit 必须绑定商品 ID | 修适配层即可继续承载单品改价 |
| per-spec 改价 | 可继续按 `specId -> fields` 写入绝对价 | LLM 必须先通过只读工具拿到 specId，不能靠规格名猜 |
| `spec-add-and-refresh` | 添加规格项后在当前页刷新并返回新结构/值 | 适合“新增规格后继续填价”的原子前置步骤 |
| `apply-current` | 在当前未保存表单页应用价格变更 | 新增规格/租期后必须走 current-page 链路，避免重新导航丢失变更 |
| `tenancy-set` | 仍是 form-level 结构变更 | 设置新租期后应使用返回值继续计划价格，不要立刻 read 服务器状态 |
| 动态租期字段 | 运行时发现任意 `rent{N}day` | 新增 45 天等租期后可立即读写，不再依赖预置 selector |
| setup-only 验证 | 结构 readback 不完整时 delayed-verify fail-closed | 不得把缺结构证据的租期/spec setup 宣称成功 |

### LLM 编排现状判断

MT 当前 rental 工具解耦已经足以支撑单步或短链路：明确端内 ID 读取、普通改价预览/执行、明确 specId 的 per-spec 改价、规格查看、单项规格操作、batch runner 控制面等。

它还不足以让 LLM 安全地自由编排复杂长队列任务。例如“把 pocket3 所有含有安心保字样的规格价格上调 30 块”需要商品组解析、active 链接过滤、逐链接规格读取、关键词匹配、字段取值、目标价计算、预览、确认、执行、verify、失败恢复。LLM 不应逐个调用底层工具并在聊天上下文中维护状态。

推荐新增业务级批量计划工具，而不是开放更多底层 action：

```json
{
  "scope": {
    "query": "pocket3",
    "resolutionMode": "sameSkuGroup",
    "requireActive": true
  },
  "target": {
    "specTitleContains": "安心保",
    "fields": ["rent1day", "rent10day", "rent30day"]
  },
  "operation": {
    "type": "adjust_amount",
    "amount": 30
  },
  "guards": {
    "maxProducts": 50,
    "maxChangePercent": 50,
    "skipRemoved": true
  }
}
```

该类工具应输出 `planId`、命中商品/规格/字段统计、blocked/warnings、完整 preview artifact 和飞书确认摘要。确认后执行 `bulkPriceApply(planId)`，执行端只读取持久化计划，不重新解释自然语言。

### 飞书定位与长任务处理

飞书不应作为工作流状态源，只应作为控制面：展示任务简报、风险摘要、确认/取消、进度摘要和最终报告。完整上下文必须落在本地 plan/run state、batch state、operation ledger 和 artifact 中。

复杂批量任务建议统一采用：

```text
自然语言 -> LLM 结构化参数 -> plan 工具生成 planId/preview
  -> 飞书审批摘要 -> apply(planId) 后台队列执行
  -> status/report/recovery -> 飞书结果摘要
```

所有高风险、多步骤、批量任务应共享计划对象、审批、执行、状态机和报告规范，但不应合并成一个万能工具。批量改价、日报驱动下架/补链、新链复制、规格清理、图片/VAS 应保留各自的 plan/apply 工具，避免单一巨大黑盒和场景过拟合。

### 接入优先级

| 优先级 | 事项 |
|---|---|
| P0 | 修复 MT 所有 daemon `submit` 调用，补 `expectedProductId` 与回归测试 |
| P0 | 用新版快照路径跑现有 rental 相关测试，确认基础 read/apply/spec/batch 兼容 |
| P1 | 迁移真实 `config.json` 到 `_dynamicFields.rentDays`，保留必要字段覆盖测试 |
| P1 | 明确 delayed-verify 手动触发和 fail-closed 报告语义 |
| P1 | 设计 `bulkPricePlan` / `bulkPriceApply(planId)` 这类业务级批量改价计划工具 |
| P2 | 为图片/VAS 增加独立 schema、确认卡、artifact 和回归后再开放 |
| P2 | 如需 mirror writeback，单独设计确认、`delayedVerify.at` 校验和审计 |

### 本地验证记录

在 `C:\works\rental-price-agent-new` 执行：

- `node --check scripts/playwright-runner.js` 通过。
- `node --check scripts/batch-runner.js` 通过。
- `node --check scripts/mirror-search.js` 通过。
- `node scripts/run-unit-tests.js` 未通过，原因是 demo 目录未安装依赖：`Cannot find module 'playwright'`。

因此本次结论是静态代码/文档审计结果，不是 live 集成验证结果。
---

## 稳定版接入再审计（2026-07-15）

审计对象：`C:\works\rental-price-agent-new`，远端 `https://gitee.com/lcc0628/rental-price-agent.git`，当前提交 `de2010c Document lifecycle workflow and multi-channel search`。本次只做静态审计和文档更新；未执行浏览器、SaaS、daemon、PM2、install、upgrade、rollback、migration 或 credentialed 操作。

### 稳定版事实

- `package.json.version = 1.0.0`，`release-manifest.json.releaseTag = v1.0.0`。
- 五类版本被拆开管理：`skillVersion`、`daemonVersion`、`protocolVersion`、`configSchemaVersion`、`stateSchemaVersion`，当前均为 `1.0.0`。
- Node 范围是 `>=18.0.0 <25.0.0`，Playwright 固定为 `1.60.0`。
- release manifest 声明 browser policy：支持 `managed-chromium` 和 `system-chrome`，默认 `system-chrome`，`allowFallback=false`。
- `scripts/lib/action-registry.js` 将动作分为 `diagnostic`、`safe-read`、`mutation`、`lifecycle-control`，并标注 `daemon`、`legacy`、`batchEmitted` surface。
- `scripts/lib/version-contract.js` 校验 package、lockfile、manifest、Node range、Playwright pin、browser policy、migration contract 和 daemon handshake metadata。
- `scripts/lib/daemon-client.js` 对普通 mutation 先发 `hello`，再附加 `_negotiation`；`ping` / `hello` 例外。
- `scripts/lib/daemon-compatibility.js` 根据 hello 与 client metadata 评估 read/write 兼容性：safe-read 在 protocol 兼容时可继续，write 要求 skill/daemon/protocol/config/state 全部兼容且 persisted state ready。
- `scripts/lib/restart-session.js` 将 `restart-required.json` 视为硬边界：旧 OpenCode session 只能 safe-read，mutation/lifecycle control 返回 `SESSION_RESTART_REQUIRED`，且 `automaticRestartAttempted=false`。
- `scripts/lib/install-layout.js` 已采用双根结构：release-owned target 与 sibling mutable data root。新 daemon token/port 位于 data root 的 `daemon/daemon.token`、`daemon/daemon.port`，不是旧 release 目录下的 `.daemon.*`。
- `scripts/lib/target-migration.json` 是 declarative migration contract v2，当前 v1.0.0 的 `steps: []`。`declarative-migration.js` 限制 JSON depth、nodes、steps、operations，并禁止危险 JSON pointer segment。`upgrade-data-transaction.js` 在 temporary layout 上迁移 managed JSON，recovery JSON byte-for-byte preserved。

### 相比 demo 审计的关键变化

此前 demo 审计重点是 SaaS 操作语义：图片、VAS、动态租期、严格 submit、checkpoint、recovery、delayed-verify fail-closed。稳定版在这些基础上补齐了发布和运行时控制面：

1. 不能再把 skill 当作“直接替换一个脚本目录”。正式接入必须处理 release target、sibling data root、receipt、journal、restart marker、daemon identity。
2. 不能再把 daemon 当成裸 HTTP JSON endpoint。mutation 应通过 hello/negotiation 绑定 instance、state digest、版本和 nonce。
3. 不能把 `install`/`upgrade`/`rollback` 混入业务写操作。它们是发布生命周期控制，和 SaaS 商品 rollback 是两套东西。
4. 不能在旧 session 中继续写。看到 `SESSION_RESTART_REQUIRED` 时只允许提示人工重启并重新 doctor。
5. 回滚能力仍然有两层边界：release rollback 只切回 release activation；SaaS batch rollback 只覆盖字段/VAS，不覆盖图片/spec/tenancy。

### MT-agent 当前不兼容点

- `src/feishuBot/rentalPrice.ts` 仍有多处 `send({ action: 'submit' })`。稳定版 daemon 要求 `{ action: 'submit', expectedProductId }`，否则提交前置校验会失败。
- `submitCurrent(expectedProductId)` 当前校验了参数，但实际仍发送裸 `submit`，需要补齐 `expectedProductId`。
- 单品改价、per-spec 改价、rollback、spec add/remove dim、spec remove item 等链路需要逐一补齐 submit 参数和回归测试。
- MT 当前 daemon URL/token 适配仍偏向旧常驻 HTTP 模式。稳定版 data root 下 token/port 路径变化，并引入 negotiation；建议新增 executor adapter，而不是在业务 handler 里散落路径和协议判断。
- `rental.batchExecute` 只暴露 `confirmFormSetupWithoutPreview`；稳定版图片批处理还要求 `confirmImageWithoutPreview`。未补 schema、确认文案和测试前，不能把图片 batch 交给 planner。
- VAS/图片虽然稳定版能力可用，但 MT 缺少独立 planner-visible schema、确认卡、回归和报告语义；先保留为人工 batch spec 或内部试点。
- delayed-verify 仍是手动步骤，且 fail-closed。MT 报告不能把 execute 完成直接描述为最终成功，必须展示 delayed verify 状态或待办。

### 业务流程工具开发方向

目标不是让 LLM 自由串低层 `read/apply/submit/verify`，而是建设稳定的业务级 plan/apply 工具。飞书只做确认卡和任务简报，人类审批的是“agent 准备执行什么、涉及哪些、风险是什么”。

推荐第一阶段只做字段批量改价：

```text
自然语言
  -> LLM 结构化意图
  -> rental.bulkPricePlan
  -> 本地 plan store / artifacts / approval card
  -> rental.bulkPriceApply(planId)
  -> executor adapter -> stable rental batch spec / daemon negotiation
  -> checkpoint / immediate verify / delayed verify todo / report / ledger
```

#### `rental.bulkPricePlan`

输入应是结构化参数，而不是自由文本执行命令：

- `scope`：商品定位来源，例如 mirror keyword、平台 fallback keyword、productIds、同款组。
- `selector`：规格命中规则，例如 spec title contains `安心保`、SKU/spec id 白名单、排除关键词。
- `operation`：价格字段与变化方式，例如 `rent1day +30`、所有 rent days +30、百分比调整、固定值。
- `guards`：最大批量、单规格最大涨跌幅、价格上下限、排除 MQ、排除链接价 0.01/0.1、是否允许 mirror miss fallback。
- `explain`：LLM 生成的人类可读理由，只用于展示，不能反解析为参数。

输出必须持久化：

- `planId`、`createdAt`、原始意图、结构化参数、版本信息。
- 候选商品、排除商品及原因、命中规格、命中字段、old/new diff、风险摘要。
- 生成的 batch spec 草稿和不可回滚范围。
- 需要人工确认的 Feishu 摘要，不把完整状态塞进卡片 payload。

#### `rental.bulkPriceApply(planId)`

执行工具只接受已持久化、未过期、已确认的 `planId`：

- 重新加载 plan，不从用户文本或卡片 reason 重新推导参数。
- 校验确认 key、plan digest、run 幂等、状态机和 batch spec digest。
- 调用 executor adapter 生成稳定版 batch spec 并执行，所有 submit 都带 `expectedProductId`。
- 串行执行，记录 per-product `submitting` / `submitted` checkpoint。
- execute 结束后只报告 immediate result；如果 delayed verify 尚未运行，状态应是待复核而非最终成功。
- delayed verify 通过后，才允许 mirror writeback；必须使用 delayed verify 的 `verified_at`，不能用当前时间兜底。

#### Executor adapter

新增一层独立 adapter，隔离业务计划与稳定版 skill 细节：

- 解析 skill target 与 sibling data root。
- 读取 daemon port/token 或调用 `daemon send`，优先复用稳定版 negotiation/client 行为。
- 归一化 `SESSION_RESTART_REQUIRED`、`DAEMON_RESTART_REQUIRED`、version mismatch、persisted state not ready、submit unknown、recovery required 等错误。
- 保证所有 current-page mutation 和 submit 都带 `expectedProductId`。
- 在测试中提供 no-real-op fake executor，不需要真实浏览器、SaaS、PM2 或凭据。

### 推荐开发顺序

1. 修 MT 现有稳定版阻断：所有裸 `submit` 补 `expectedProductId`，补单品、per-spec、rollback、spec 操作测试。
2. 新增 rental executor adapter，适配 stable data root / daemon negotiation / fake executor。
3. 新增 plan store、plan digest、run state、decision id、ledger 记录和报告 artifact。
4. 实现 `rental.bulkPricePlan`，先支持 mirror/platform 定位 + spec contains + rent field amount 调整。
5. 实现 Feishu 审批卡，只展示简报、数量、排除、风险、diff 摘要和确认 key。
6. 实现 `rental.bulkPriceApply(planId)`，只执行已确认 plan，并把 delayed verify/mirror writeback 分成后续显式步骤。
7. 用 golden cases 覆盖“pocket3 所有含安心保字样的规格价格上调 30 块”、排除 MQ、排除链接价、无命中、超最大批量、价格越界、重复确认、plan 过期、executor fake failure。
8. 字段批量改价稳定后，再按同一 plan/apply 框架扩展 VAS、图片、规格/租期结构变更。不要先开放这些高风险能力给 LLM。

### 审计未执行项

- 未启动或停止 daemon。
- 未访问 SaaS、未打开浏览器、未读取真实 `.env`、未读取 browser profile。
- 未执行 lifecycle `install`、`upgrade`、`rollback`、`doctor`。
- 未执行 PM2 操作、未发送飞书消息、未做真实商品写入。
