# Cumulocity IoT Edge - ACME

This repository contains the sources for an ACME microservice that can be used to periodically issue/renew certificates for the Cumulocity IoT Edge. This allows you to operate your c8y Edge with valid certificates signed by e.g. [Let's Encrypt](https://letsencrypt.org/). The certificates signed by e.g. Let's Encrypt only have a limited validity of 90 days. So they need to be renewed at some point within this 90 days period. This microservice takes care of this as well.

This microservices uses in the background the [acme.sh script](https://github.com/acmesh-official/acme.sh) which also supports [further CAs](https://github.com/acmesh-official/acme.sh#supported-ca). For now this microservice only supports the [DNS-01 challenge](https://letsencrypt.org/docs/challenge-types/#dns-01-challenge), this allows to issue/renew certificates even if the Cumulocity IoT Edge is not accessible via the public internet.

The acme.sh script supports at the time of writing [140+ different DNS providers](https://github.com/acmesh-official/acme.sh/wiki/dnsapi) that can be used to perform the DNS-01 challenge.

If your current DNS provider is not supported or you do not want to have the credentials to your domain stored on the edge, you could also look into the [DNS alias mode](https://github.com/acmesh-official/acme.sh/wiki/DNS-alias-mode). This allows you to perform the DNS-01 challenge via one of the supported providers while still keeping your current DNS provider.

## Functionalities

After the initial setup, the microservice has a scheduled task which runs once a day to check if the certificate should be renewed. This task is performed at a random time of the day. If the certificate is due to renewal, it will be renewed and the certificate of the edge will be exchanged.

Note that the replacement of the certificate might cause that the HTTPS and MQTTS services of the edge are unavailable for a short amount of time. So you should make sure to only renew the certificates only when it is needed. Per default the renewal will be performed 20 days before the certificate expiration.

## Initial setup

The microservice needs to be hosted on the management tenant of the edge.

The microserivce will be configured via tenant options. All tenant options use the microservices name: ``acme`` as category. The following options are available:

| Key | Description | acme.sh parameter | Default value | Required
|-----|---|---|---|---|
|dns_provider|One of the [supported DNS providers](https://github.com/acmesh-official/acme.sh/wiki/dnsapi) e.g. ``dns_duckdns``|``--dns``|--|✅|
|server|One of the [supported ACME servers](https://github.com/acmesh-official/acme.sh/wiki/Server) e.g. ``letsencrypt``|``--server``|``letsencrypt_test``|✅|
|dnssleep|Seconds to sleep after the DNS TXT record is added, [more details](https://github.com/acmesh-official/acme.sh/wiki/dnssleep) e.g. ``900``|``--dnssleep``|``0``|❌|
|domain|The domain to request the certificate for, e.g. ``myown.iot.com``|``-d``|domain of the edge tenant|❌|
|edge_ip|For the certificate replacement we need the IP address of the edge, e.g. ``192.168.66.10``|N/a|--|✅|
|mail|The mail address that will be set for the account at the ACME server. Depending on the provider you will receive expiry notifications. e.g. ``admin@iot.com``|``-m``|--|❌|
|challenge_alias|An alias domain to be used for the DNS-01 challenge [details](https://github.com/acmesh-official/acme.sh/wiki/DNS-alias-mode)|``--challenge-alias``|--|❌|
|renew_days_before_expiry|The number of days the current certificate needs to be still vaild, otherwise a renewal will be triggered. If e.g. the period a certificate is valid after issueing it is 90 days and you set this value to 89, the certificate will be renewed 1 day after issueing/renewing the old one (daily).|N/a|``20``|❌|
|insecure|Some DNS providers might require you to set this flag to ``true`` since their API might be using a certificate that can not be verified.|``--insecure``|``false``|❌|
|debug|For a more detailed output of the acme.sh script|``--debug``|``false``|❌|
|skip_cert_replacement|   |N/a|``false``|❌|
|add_wildcard_sub|If set to ``true``, not only a certificate for e.g. ``myown.iot.com`` will issued, but also for ``*.myown.iot.com``|N/a|``false``|❌|
|add_wildcard_main|If set to ``true``, instead of ``myown.iot.com``, a certificate for ``*.iot.com`` will be issued|N/a|``false``|❌|

After you have identified your DNS provider [here](https://github.com/acmesh-official/acme.sh/wiki/dnsapi) you might have already noticed that you need to set some provider specific environemt variables. For the DuckDNS provider this would e.g. be the ``DuckDNS_Token`` variable. Those environment variables can just be set by creating them as a tenant option (category: ``acme``, key: ``<env-variable-key>`` e.g. ``DuckDNS_Token``, value: ``<env-variable-value>``). If the environment variable contains sensitive data, you can also use the encryption mechanism of the tenant options by prefixing the key with ``credentials.`` e.g. like this ``credentials.DuckDNS_Token``.

After setting the above mentioned tenant options according to your needs, you can trigger a forced renewal of the certificate by performing a POST on ``{{url}}/service/acme/forceRenew`` with an empty body and credentials of the edge management tenant.

If the request succeeds with status code ``200 OK`` everything should be correctly setup. If not, please have a look at the microservice logs.

## Good to know

The microservice is storing the overall configuration, certificates and keys generated by the acme.sh script after each run in an encrypted archive which is uploaded via the inventory binary API. This allows us to restore the last microservice state after a microservice restart/update/crash. The key/password used for the encryption of the archive is stored as an encrypted tenant option (key: ``archive_encryption_key``).

In case of an issue that might be caused by a bad/incompatible previous configuration, I recommend to remove the ``acme.sh.tar.gz.enc`` file via the file repository and restart the microservice.

------------------------------

This tools are provided as-is and without warranty or support. They do not constitute part of the Software AG product suite. Users are free to use, fork and modify them, subject to the license agreement. While Software AG welcomes contributions, we cannot guarantee to include every contribution in the master project.
_____________________
For more information you can Ask a Question in the [TECHcommunity Forums](http://tech.forums.softwareag.com/techjforum/forums/list.page?product=cumulocity).

You can find additional information in the [Software AG TECHcommunity](http://techcommunity.softwareag.com/home/-/product/name/cumulocity).
