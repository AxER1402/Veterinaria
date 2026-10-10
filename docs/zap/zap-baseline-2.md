# ZAP Scanning Report

ZAP by [Checkmarx](https://checkmarx.com/).


## Summary of Alerts

| Risk Level | Number of Alerts |
| --- | --- |
| High | 0 |
| Medium | 0 |
| Low | 3 |
| Informational | 6 |




## Insights

| Level | Reason | Site | Description | Statistic |
| --- | --- | --- | --- | --- |
| Low | Warning |  | ZAP warnings logged - see the zap.log file for details | 8    |
| Info | Informational | https://host.docker.internal:8443 | Percentage of responses with status code 2xx | 94 % |
| Info | Informational | https://host.docker.internal:8443 | Percentage of responses with status code 3xx | 4 % |
| Info | Informational | https://host.docker.internal:8443 | Percentage of responses with status code 4xx | 1 % |
| Info | Informational | https://host.docker.internal:8443 | Percentage of endpoints with content type application/javascript | 4 % |
| Info | Informational | https://host.docker.internal:8443 | Percentage of endpoints with content type application/json | 9 % |
| Info | Informational | https://host.docker.internal:8443 | Percentage of endpoints with content type font/woff2 | 31 % |
| Info | Informational | https://host.docker.internal:8443 | Percentage of endpoints with content type image/svg+xml | 4 % |
| Info | Informational | https://host.docker.internal:8443 | Percentage of endpoints with content type text/css | 4 % |
| Info | Informational | https://host.docker.internal:8443 | Percentage of endpoints with content type text/html | 45 % |
| Info | Informational | https://host.docker.internal:8443 | Percentage of endpoints with method GET | 95 % |
| Info | Informational | https://host.docker.internal:8443 | Percentage of endpoints with method POST | 4 % |
| Info | Informational | https://host.docker.internal:8443 | Count of total endpoints | 22    |
| Info | Informational | https://images.unsplash.com | Percentage of endpoints with content type image/avif | 100 % |
| Info | Informational | https://images.unsplash.com | Percentage of endpoints with method GET | 100 % |
| Info | Informational | https://images.unsplash.com | Count of total endpoints | 39    |
| Info | Informational | https://mail.google.com | Percentage of endpoints with content type application/binary | 100 % |
| Info | Informational | https://mail.google.com | Percentage of endpoints with method GET | 100 % |
| Info | Informational | https://mail.google.com | Count of total endpoints | 1    |
| Info | Informational | https://maps.googleapis.com | Percentage of endpoints with content type application/json | 5 % |
| Info | Informational | https://maps.googleapis.com | Percentage of endpoints with content type image/png | 26 % |
| Info | Informational | https://maps.googleapis.com | Percentage of endpoints with content type text/javascript | 68 % |
| Info | Informational | https://maps.googleapis.com | Percentage of endpoints with method GET | 100 % |
| Info | Informational | https://maps.googleapis.com | Count of total endpoints | 19    |
| Info | Informational | https://maps.gstatic.com | Percentage of endpoints with content type text/javascript | 100 % |
| Info | Informational | https://maps.gstatic.com | Percentage of endpoints with method GET | 100 % |
| Info | Informational | https://maps.gstatic.com | Count of total endpoints | 1    |
| Info | Informational | https://ssl.gstatic.com | Percentage of endpoints with content type image/x-icon | 100 % |
| Info | Informational | https://ssl.gstatic.com | Percentage of endpoints with method GET | 100 % |
| Info | Informational | https://ssl.gstatic.com | Count of total endpoints | 1    |
| Info | Informational | https://www.google.com | Percentage of endpoints with content type text/html | 100 % |
| Info | Informational | https://www.google.com | Percentage of endpoints with method GET | 100 % |
| Info | Informational | https://www.google.com | Count of total endpoints | 3    |







## Alerts

| Name | Risk Level | Number of Instances |
| --- | --- | --- |
| Cross-Origin-Embedder-Policy Header Missing or Invalid | Low | 4 |
| Cross-Origin-Opener-Policy Header Missing or Invalid | Low | 4 |
| Timestamp Disclosure - Unix | Low | Systemic |
| Information Disclosure - Information in Browser localStorage | Informational | 1 |
| Information Disclosure - Suspicious Comments | Informational | 1 |
| Modern Web Application | Informational | Systemic |
| Re-examine Cache-control Directives | Informational | 4 |
| Retrieved from Cache | Informational | 1 |
| Storable and Cacheable Content | Informational | Systemic |




## Alert Detail



### [ Cross-Origin-Embedder-Policy Header Missing or Invalid ](https://www.zaproxy.org/docs/alerts/90004/)



##### Low (Medium)

### Description

Cross-Origin-Embedder-Policy header is a response header that prevents a document from loading any cross-origin resources that don't explicitly grant the document permission (using CORP or CORS).

* URL: https://host.docker.internal:8443
  * Node Name: `https://host.docker.internal:8443`
  * Method: `GET`
  * Parameter: `Cross-Origin-Embedder-Policy`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: https://host.docker.internal:8443/
  * Node Name: `https://host.docker.internal:8443/`
  * Method: `GET`
  * Parameter: `Cross-Origin-Embedder-Policy`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: https://host.docker.internal:8443/robots.txt
  * Node Name: `https://host.docker.internal:8443/robots.txt`
  * Method: `GET`
  * Parameter: `Cross-Origin-Embedder-Policy`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: https://host.docker.internal:8443/sitemap.xml
  * Node Name: `https://host.docker.internal:8443/sitemap.xml`
  * Method: `GET`
  * Parameter: `Cross-Origin-Embedder-Policy`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``


Instances: 4

### Solution

Ensure that the application/web server sets the Cross-Origin-Embedder-Policy header appropriately, and that it sets the Cross-Origin-Embedder-Policy header to 'require-corp' for documents.
If possible, ensure that the end user uses a standards-compliant and modern web browser that supports the Cross-Origin-Embedder-Policy header (https://caniuse.com/mdn-http_headers_cross-origin-embedder-policy).

### Reference


* [ https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy ](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy)


#### CWE Id: [ 693 ](https://cwe.mitre.org/data/definitions/693.html)


#### WASC Id: 14

#### Source ID: 3

### [ Cross-Origin-Opener-Policy Header Missing or Invalid ](https://www.zaproxy.org/docs/alerts/90004/)



##### Low (Medium)

### Description

Cross-Origin-Opener-Policy header is a response header that allows a site to control if others included documents share the same browsing context. Sharing the same browsing context with untrusted documents might lead to data leak.

* URL: https://host.docker.internal:8443
  * Node Name: `https://host.docker.internal:8443`
  * Method: `GET`
  * Parameter: `Cross-Origin-Opener-Policy`
  * Attack: ``
  * Evidence: `same-origin-allow-popups`
  * Other Info: ``
* URL: https://host.docker.internal:8443/
  * Node Name: `https://host.docker.internal:8443/`
  * Method: `GET`
  * Parameter: `Cross-Origin-Opener-Policy`
  * Attack: ``
  * Evidence: `same-origin-allow-popups`
  * Other Info: ``
* URL: https://host.docker.internal:8443/robots.txt
  * Node Name: `https://host.docker.internal:8443/robots.txt`
  * Method: `GET`
  * Parameter: `Cross-Origin-Opener-Policy`
  * Attack: ``
  * Evidence: `same-origin-allow-popups`
  * Other Info: ``
* URL: https://host.docker.internal:8443/sitemap.xml
  * Node Name: `https://host.docker.internal:8443/sitemap.xml`
  * Method: `GET`
  * Parameter: `Cross-Origin-Opener-Policy`
  * Attack: ``
  * Evidence: `same-origin-allow-popups`
  * Other Info: ``


Instances: 4

### Solution

Ensure that the application/web server sets the Cross-Origin-Opener-Policy header appropriately, and that it sets the Cross-Origin-Opener-Policy header to 'same-origin' for documents.
'same-origin-allow-popups' is considered as less secured and should be avoided.
If possible, ensure that the end user uses a standards-compliant and modern web browser that supports the Cross-Origin-Opener-Policy header (https://caniuse.com/mdn-http_headers_cross-origin-opener-policy).

### Reference


* [ https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Opener-Policy ](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Opener-Policy)


#### CWE Id: [ 693 ](https://cwe.mitre.org/data/definitions/693.html)


#### WASC Id: 14

#### Source ID: 3

### [ Timestamp Disclosure - Unix ](https://www.zaproxy.org/docs/alerts/10096/)



##### Low (Low)

### Description

A timestamp was disclosed by the application/web server. - Unix

* URL: https://host.docker.internal:8443/assets/index-DnGYArGJ.js
  * Node Name: `https://host.docker.internal:8443/assets/index-DnGYArGJ.js`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `1543466835`
  * Other Info: `1543466835, which evaluates to: 2018-11-29 04:47:15.`
* URL: https://host.docker.internal:8443/assets/index-DnGYArGJ.js
  * Node Name: `https://host.docker.internal:8443/assets/index-DnGYArGJ.js`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `1548199973`
  * Other Info: `1548199973, which evaluates to: 2019-01-22 23:32:53.`
* URL: https://host.docker.internal:8443/assets/index-DnGYArGJ.js
  * Node Name: `https://host.docker.internal:8443/assets/index-DnGYArGJ.js`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `1552053831`
  * Other Info: `1552053831, which evaluates to: 2019-03-08 14:03:51.`
* URL: https://host.docker.internal:8443/assets/index-DnGYArGJ.js
  * Node Name: `https://host.docker.internal:8443/assets/index-DnGYArGJ.js`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `1560807707`
  * Other Info: `1560807707, which evaluates to: 2019-06-17 21:41:47.`
* URL: https://host.docker.internal:8443/assets/index-DnGYArGJ.js
  * Node Name: `https://host.docker.internal:8443/assets/index-DnGYArGJ.js`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `1561037404`
  * Other Info: `1561037404, which evaluates to: 2019-06-20 13:30:04.`

Instances: Systemic


### Solution

Manually confirm that the timestamp data is not sensitive, and that the data cannot be aggregated to disclose exploitable patterns.

### Reference


* [ https://cwe.mitre.org/data/definitions/200.html ](https://cwe.mitre.org/data/definitions/200.html)


#### CWE Id: [ 497 ](https://cwe.mitre.org/data/definitions/497.html)


#### WASC Id: 13

#### Source ID: 3

### [ Information Disclosure - Information in Browser localStorage ](https://www.zaproxy.org/docs/alerts/120000/)



##### Informational (High)

### Description

Information was stored in browser localStorage.
This is not unusual or necessarily unsafe - this informational alert has been raised to help you get a better understanding of what this app is doing. For more details see the Client tabs - this information was set directly in the browser and will therefore not necessarily appear in this form in any HTTP(S) messages.

* URL: https://host.docker.internal:8443/
  * Node Name: `https://host.docker.internal:8443/`
  * Method: `GET`
  * Parameter: `huellitas-shop`
  * Attack: ``
  * Evidence: ``
  * Other Info: `The following data (key=value) was set: huellitas-shop={"cart":[],"wishlist":[],"coupon":null}
Note that this alert will only be raised once for each URL + key.`


Instances: 1

### Solution

This is an informational alert and no action is necessary. 

### Reference



#### CWE Id: [ 359 ](https://cwe.mitre.org/data/definitions/359.html)


#### WASC Id: 13

#### Source ID: 3

### [ Information Disclosure - Suspicious Comments ](https://www.zaproxy.org/docs/alerts/10027/)



##### Informational (Medium)

### Description

The response appears to contain suspicious comments which may help an attacker.

* URL: https://host.docker.internal:8443/assets/index-DnGYArGJ.js
  * Node Name: `https://host.docker.internal:8443/assets/index-DnGYArGJ.js`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `enemos informado en todo momento.`},{title:``
  * Other Info: `The following pattern was used: \bTODO\b and was detected in likely comment: "//,``).split(`/`);p=`/`+f.replace(/^\//,``).split(`/`).slice(e.length).join(`/`)}let m=n&&n.state.matches.length?n.state.matches", see evidence field for the suspicious comment/snippet.`


Instances: 1

### Solution

Remove all comments that return information that may help an attacker and fix any underlying problems they refer to.

### Reference



#### CWE Id: [ 615 ](https://cwe.mitre.org/data/definitions/615.html)


#### WASC Id: 13

#### Source ID: 3

### [ Modern Web Application ](https://www.zaproxy.org/docs/alerts/10109/)



##### Informational (Medium)

### Description

The application appears to be a modern web application. If you need to explore it automatically then the Client Spider may well be more effective than the standard one.

* URL: https://host.docker.internal:8443
  * Node Name: `https://host.docker.internal:8443`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `<script type="module" crossorigin src="/assets/index-DnGYArGJ.js"></script>`
  * Other Info: `No links have been found while there are scripts, which is an indication that this is a modern web application.`
* URL: https://host.docker.internal:8443/
  * Node Name: `https://host.docker.internal:8443/`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `<script type="module" crossorigin src="/assets/index-DnGYArGJ.js"></script>`
  * Other Info: `No links have been found while there are scripts, which is an indication that this is a modern web application.`
* URL: https://host.docker.internal:8443/robots.txt
  * Node Name: `https://host.docker.internal:8443/robots.txt`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `<script type="module" crossorigin src="/assets/index-DnGYArGJ.js"></script>`
  * Other Info: `No links have been found while there are scripts, which is an indication that this is a modern web application.`
* URL: https://host.docker.internal:8443/servicios
  * Node Name: `https://host.docker.internal:8443/servicios`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `<script type="module" crossorigin src="/assets/index-DnGYArGJ.js"></script>`
  * Other Info: `No links have been found while there are scripts, which is an indication that this is a modern web application.`
* URL: https://host.docker.internal:8443/sitemap.xml
  * Node Name: `https://host.docker.internal:8443/sitemap.xml`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `<script type="module" crossorigin src="/assets/index-DnGYArGJ.js"></script>`
  * Other Info: `No links have been found while there are scripts, which is an indication that this is a modern web application.`

Instances: Systemic


### Solution

This is an informational alert and so no changes are required.

### Reference




#### Source ID: 3

### [ Re-examine Cache-control Directives ](https://www.zaproxy.org/docs/alerts/10015/)



##### Informational (Low)

### Description

The cache-control header has not been set properly or is missing, allowing the browser and proxies to cache content. For static assets like css, js, or image files this might be intended, however, the resources should be reviewed to ensure that no sensitive content will be cached.

* URL: https://host.docker.internal:8443
  * Node Name: `https://host.docker.internal:8443`
  * Method: `GET`
  * Parameter: `cache-control`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: https://host.docker.internal:8443/
  * Node Name: `https://host.docker.internal:8443/`
  * Method: `GET`
  * Parameter: `cache-control`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: https://host.docker.internal:8443/api/catalogo/productos
  * Node Name: `https://host.docker.internal:8443/api/catalogo/productos`
  * Method: `GET`
  * Parameter: `cache-control`
  * Attack: ``
  * Evidence: `no-store`
  * Other Info: ``
* URL: https://host.docker.internal:8443/robots.txt
  * Node Name: `https://host.docker.internal:8443/robots.txt`
  * Method: `GET`
  * Parameter: `cache-control`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``


Instances: 4

### Solution

For secure content, ensure the cache-control HTTP header is set with "no-cache, no-store, must-revalidate". If an asset should be cached consider setting the directives "public, max-age, immutable".

### Reference


* [ https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html#web-content-caching ](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html#web-content-caching)
* [ https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control ](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control)
* [ https://grayduck.mn/2021/09/13/cache-control-recommendations/ ](https://grayduck.mn/2021/09/13/cache-control-recommendations/)


#### CWE Id: [ 525 ](https://cwe.mitre.org/data/definitions/525.html)


#### WASC Id: 13

#### Source ID: 3

### [ Retrieved from Cache ](https://www.zaproxy.org/docs/alerts/10050/)



##### Informational (Medium)

### Description

The content was retrieved from a shared cache. If the response data is sensitive, personal or user-specific, this may result in sensitive information being leaked. In some cases, this may even result in a user gaining complete control of the session of another user, depending on the configuration of the caching components in use in their environment. This is primarily an issue where caching servers such as "proxy" caches are configured on the local network. This configuration is typically found in corporate or educational environments, for instance.

* URL: https://host.docker.internal:8443/api/catalogo/productos
  * Node Name: `https://host.docker.internal:8443/api/catalogo/productos`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `HIT`
  * Other Info: ``


Instances: 1

### Solution

Validate that the response does not contain sensitive, personal or user-specific information. If it does, consider the use of the following HTTP response headers, to limit, or prevent the content being stored and retrieved from the cache by another user:
Cache-Control: no-cache, no-store, must-revalidate, private
Pragma: no-cache
Expires: 0
This configuration directs both HTTP 1.0 and HTTP 1.1 compliant caching servers to not store the response, and to not retrieve the response (without validation) from the cache, in response to a similar request.

### Reference


* [ https://datatracker.ietf.org/doc/html/rfc7234 ](https://datatracker.ietf.org/doc/html/rfc7234)
* [ https://datatracker.ietf.org/doc/html/rfc7231 ](https://datatracker.ietf.org/doc/html/rfc7231)
* [ https://www.rfc-editor.org/rfc/rfc9110.html ](https://www.rfc-editor.org/rfc/rfc9110.html)


#### CWE Id: [ 525 ](https://cwe.mitre.org/data/definitions/525.html)


#### Source ID: 3

### [ Storable and Cacheable Content ](https://www.zaproxy.org/docs/alerts/10049/)



##### Informational (Medium)

### Description

The response contents are storable by caching components such as proxy servers, and may be retrieved directly from the cache, rather than from the origin server by the caching servers, in response to similar requests from other users. If the response data is sensitive, personal or user-specific, this may result in sensitive information being leaked. In some cases, this may even result in a user gaining complete control of the session of another user, depending on the configuration of the caching components in use in their environment. This is primarily an issue where "shared" caching servers such as "proxy" caches are configured on the local network. This configuration is typically found in corporate or educational environments, for instance.

* URL: https://host.docker.internal:8443
  * Node Name: `https://host.docker.internal:8443`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: ``
  * Other Info: `In the absence of an explicitly specified caching lifetime directive in the response, a liberal lifetime heuristic of 1 year was assumed. This is permitted by rfc7234.`
* URL: https://host.docker.internal:8443/assets/index-BnJLFAYs.css
  * Node Name: `https://host.docker.internal:8443/assets/index-BnJLFAYs.css`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `max-age=31536000`
  * Other Info: ``
* URL: https://host.docker.internal:8443/favicon.svg
  * Node Name: `https://host.docker.internal:8443/favicon.svg`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: ``
  * Other Info: `In the absence of an explicitly specified caching lifetime directive in the response, a liberal lifetime heuristic of 1 year was assumed. This is permitted by rfc7234.`
* URL: https://host.docker.internal:8443/robots.txt
  * Node Name: `https://host.docker.internal:8443/robots.txt`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: ``
  * Other Info: `In the absence of an explicitly specified caching lifetime directive in the response, a liberal lifetime heuristic of 1 year was assumed. This is permitted by rfc7234.`
* URL: https://host.docker.internal:8443/sitemap.xml
  * Node Name: `https://host.docker.internal:8443/sitemap.xml`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: ``
  * Other Info: `In the absence of an explicitly specified caching lifetime directive in the response, a liberal lifetime heuristic of 1 year was assumed. This is permitted by rfc7234.`

Instances: Systemic


### Solution

Validate that the response does not contain sensitive, personal or user-specific information. If it does, consider the use of the following HTTP response headers, to limit, or prevent the content being stored and retrieved from the cache by another user:
Cache-Control: no-cache, no-store, must-revalidate, private
Pragma: no-cache
Expires: 0
This configuration directs both HTTP 1.0 and HTTP 1.1 compliant caching servers to not store the response, and to not retrieve the response (without validation) from the cache, in response to a similar request.

### Reference


* [ https://datatracker.ietf.org/doc/html/rfc7234 ](https://datatracker.ietf.org/doc/html/rfc7234)
* [ https://datatracker.ietf.org/doc/html/rfc7231 ](https://datatracker.ietf.org/doc/html/rfc7231)
* [ https://www.w3.org/Protocols/rfc2616/rfc2616-sec13.html ](https://www.w3.org/Protocols/rfc2616/rfc2616-sec13.html)


#### CWE Id: [ 524 ](https://cwe.mitre.org/data/definitions/524.html)


#### WASC Id: 13

#### Source ID: 3


