# popdown
Isolate and remove marketing and GDPR popups from websites

## Data Collection

Wait for the page to fully load. If you notice scroll has been hijacked this can usually be dealt with another page.

```
npm run crawl
```

## Dataset Storage

For now I'm storing the dataset mainly on my local with backups to S3 through [rclone](https://rclone.org/). Once this dataset is large enough and there's a shipping experimentation flow I'll release this into the commons.

```
rclone sync -i /local/path remote:path
```

## Debugging

If your websites aren't rendering in the recording tool like you see in your other browsers, it might be because of request mismatch. We can debug the outbound requests at the host networking level through any local proxying tool. If you're on a Mac, [Proxyman](https://proxyman.io/) is recommended.

The `fetch` requests that node issues won't display by [default](https://github.com/ProxymanApp/Proxyman/issues/236). To address this, export the following environment variables before your debugging session.

```
export http_proxy=http://127.0.01:9090
export https_proxy=http://127.0.01:9090
```

//"http-mitm-proxy": "github:joeferner/node-http-mitm-proxy#master",
