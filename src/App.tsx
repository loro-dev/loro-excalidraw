import { useEffect, useMemo, useRef, useState } from 'react'
import '@radix-ui/themes/styles.css';
import { Excalidraw } from '@excalidraw/excalidraw';
import { Slider } from '@radix-ui/themes';
import { Loro, LoroList, LoroMap, OpId, toReadableVersion } from 'loro-crdt';
import deepEqual from 'deep-equal';
import './App.css'
import { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types/types';

function opIdToString(id: OpId): string {
  return `${id.counter}@${id.peer.toString()}`
}

function frontierToString(frontier: OpId[]): string {
  return frontier.map(opIdToString).join(",")
}

function frontiersToString(frontiers: OpId[][]): string {
  return frontiers.map(frontierToString).join(";");
}

function stringToOpId(str: string): OpId {
  const [counter, peer] = str.split("@");
  return {
    counter: parseInt(counter),
    peer: BigInt(peer)
  }
}

function stringToFrontier(str: string): OpId[] {
  return str.split(",").map(stringToOpId);
}

function stringToFrontiers(str: string): OpId[][] {
  if (str === "") {
    return [];
  }

  return str.split(";").map(stringToFrontier);
}

function App() {
  const excalidrawAPI = useRef<ExcalidrawImperativeAPI>();
  const versionsRef = useRef<OpId[][]>([]);
  const [maxVersion, setMaxVersion] = useState(-1);
  const [docSize, setDocSize] = useState(0);
  const [vv, setVV] = useState("")
  const channel = useMemo(() => {
    return new BroadcastChannel("temp");
  }, []);
  useEffect(() => {
    return () => {
      channel.close();
    }
  }, [channel]);
  const [versionNum, setVersionNum] = useState(-1);

  const { doc, docElements } = useMemo(() => {
    const doc = new Loro();
    const data = localStorage.getItem("store");
    setTimeout(() => {
      const versions = localStorage.getItem("frontiers");
      versionsRef.current = stringToFrontiers(versions || "");
      setMaxVersion(versionsRef.current.length - 1);
      setVersionNum(versionsRef.current.length - 1)
    });

    const docElements = doc.getList("elements");
    let lastVersion: Uint8Array | undefined = undefined;
    channel.onmessage = e => {
      console.log("Event");
      const bytes = new Uint8Array(e.data);
      doc.import(bytes);
    };
    doc.subscribe((e) => {
      const version = Object.fromEntries(toReadableVersion(doc.version()));
      let vv = ""
      for (const [k, v] of Object.entries(version)) {
        vv += `${k.toString().slice(0, 4)}:${v} `
      }

      setVV(vv);
      if (e.local) {
        const bytes = doc.exportFrom(lastVersion);
        lastVersion = doc.version();
        channel.postMessage(bytes);
      }
      if (!e.fromCheckout) {
        versionsRef.current.push(doc.frontiers())
        setMaxVersion(versionsRef.current.length - 1);
        setVersionNum(versionsRef.current.length - 1)
        const data = doc.exportFrom();
        localStorage.setItem("store", btoa(String.fromCharCode(...data)));
        localStorage.setItem("frontiers", frontiersToString(versionsRef.current));
        setDocSize(data.length);
      }
      if (e.fromCheckout || !e.local) {
        excalidrawAPI.current?.updateScene({ elements: docElements.getDeepValue() })
      }
    });
    setTimeout(() => {
      if (data && data?.length > 0) {
        const bytes = new Uint8Array(atob(data).split("").map(function (c) { return c.charCodeAt(0) }));
        doc.checkoutToLatest();
        doc.import(bytes);
        setMaxVersion(versionsRef.current.length - 1);
        setVersionNum(versionsRef.current.length - 1)
      }
    }, 100);
    return { doc, docElements }
  }, [channel]);

  const lastVersion = useRef(-1);
  return (
    <div >
      <div style={{ width: "100%", height: "calc(100vh - 100px)" }}>
        <Excalidraw
          excalidrawAPI={api => { excalidrawAPI.current = api }}
          viewModeEnabled={versionNum !== maxVersion}
          onChange={(elements) => {
            const v = getVersion(elements);
            if (lastVersion.current === v) {
              // local change, should detect and record the diff to loro doc
              if (recordLocalOps(docElements, elements)) {
                doc.commit();
              }
              // if (!deepEqual(docElements.getDeepValue(), elements)) {
              //   console.log(docElements.getDeepValue(), elements);
              // }
            }

            lastVersion.current = v;
          }}
        />
      </div>
      <div style={{ margin: "1em 2em" }}>
        <div style={{ fontSize: "0.8em" }}>
          <button onClick={() => {
            localStorage.clear();
            location.reload();
          }}>Clear</button> Version Vector {vv}, Doc Size {docSize} bytes
        </div>
        <Slider value={[versionNum]} min={-1} max={maxVersion} onValueChange={(v) => {
          setVersionNum(v[0]);
          if (v[0] === -1) {
            doc.checkout([]);
          } else {
            if (v[0] === versionsRef.current.length - 1) {
              doc.checkoutToLatest()
            } else {
              doc.checkout(versionsRef.current[v[0]]);
            }
          }
        }} />
      </div>
    </div>
  )
}

function recordLocalOps(loroList: LoroList, elements: readonly { version: number }[]): boolean {
  let changed = false;
  for (let i = loroList.length; i < elements.length; i++) {
    loroList.insertContainer(i, "Map");
    changed = true;
  }

  for (let i = 0; i < elements.length; i++) {
    const map = loroList.get(i) as LoroMap;
    const elem = elements[i];
    if (map.get("version") === elem.version) {
      continue;
    }

    for (const [key, value] of Object.entries(elem)) {
      const src = map.get(key);
      if ((typeof src === "object" && !deepEqual(map.get(key), value)) || src !== value) {
        changed = true;
        map.set(key, value)
      }
    }
  }

  return changed
}

function getVersion(elems: readonly { version: number }[]): number {
  return elems.reduce((acc, curr) => {
    return curr.version + acc
  }, 0)
}

export default App
