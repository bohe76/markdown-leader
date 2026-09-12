"""격리 리더에서 최근 30개와 즐겨찾기의 폴더 접근 복원을 검증한다."""
import json
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect


def main():
    root=Path(__file__).resolve().parents[1]
    with tempfile.TemporaryDirectory(prefix='ml-library-') as profile, sync_playwright() as runtime:
        context=runtime.chromium.launch_persistent_context(profile,headless=True,channel='chromium',args=[f'--disable-extensions-except={root/"dist"}',f'--load-extension={root/"dist"}'])
        try:
            worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
            page=context.new_page(); errors=[]
            page.on('pageerror',lambda error:errors.append(str(error)))
            page.goto(f'chrome-extension://{worker.url.split("/")[2]}/reader.html')
            expect(page.locator('.ml-welcome')).to_be_visible()
            page.evaluate(r"""async()=>{
                const base=await navigator.storage.getDirectory();const folder=await base.getDirectoryHandle('library-check',{create:true});
                for(let i=0;i<32;i++){
                    const f=await folder.getFileHandle(`file-${String(i).padStart(2,'0')}.md`,{create:true});const w=await f.createWritable();
                    await w.write(`# File ${i}\n\n`+(i===0?'![image](pixel.png)':'Text.'));await w.close();
                }
                const f=await folder.getFileHandle('pixel.png',{create:true});const w=await f.createWritable();
                await w.write(Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='),c=>c.charCodeAt(0)));await w.close();
                window.showDirectoryPicker=async()=>folder;
            }""")
            page.locator('.ml-ribbon [data-open-folder]').click()
            tree=page.get_by_test_id('file-tree');content=page.get_by_test_id('markdown-content')
            tree.get_by_role('link',name='file-00.md',exact=True).click()
            expect(content.locator('h1')).to_have_text('File 0')
            page.locator('.ml-document-tab.is-active .ml-document-tab-favorite').click()
            expect(page.locator('.ml-document-tab.is-active .ml-document-tab-favorite')).to_have_attribute('aria-pressed','true')
            for i in range(1,32):
                tree.get_by_role('link',name=f'file-{i:02}.md',exact=True).click()
                expect(content.locator('h1')).to_have_text(f'File {i}')
            page.wait_for_function("async()=>Object.values(await chrome.storage.local.get(null)).some(e=>e?.name==='file-31.md')")
            page.locator('[data-tab="recent"]').click()
            expect(page.locator('[data-panel="recent"] .ml-library-row')).to_have_count(30)
            expect(page.locator('[data-panel="recent"] .ml-library-open').first).to_contain_text('file-31.md')
            page.reload()
            expect(page.locator('.ml-welcome')).to_be_visible()
            page.locator('[data-tab="favorites"]').click()
            expect(page.locator('[data-panel="favorites"] .ml-library-row')).to_have_count(1)
            page.locator('[data-panel="favorites"] .ml-library-open').click()
            expect(content.locator('h1')).to_have_text('File 0')
            page.wait_for_function("document.querySelector('.ml-document img')?.naturalWidth===1")
            page.locator('[data-tab="recent"]').click()
            expect(page.locator('[data-panel="recent"] .ml-library-row')).to_have_count(30)
            expect(page.locator('[data-panel="recent"] .ml-library-open').first).to_contain_text('file-00.md')
            page.locator('[data-panel="recent"] .ml-library-open').first.click()
            expect(page.locator('.ml-document-tab')).to_have_count(1)
            expect(page.locator('[data-panel="recent"] .ml-library-row')).to_have_count(30)
            assert not errors,errors
            print(json.dumps({'recent_limit':30,'favorite_survives_eviction_reload':True,'folder_image_scope_restored':True,'reopen_dedup':True,'errors':errors}))
        finally:context.close()


if __name__=='__main__':main()
