import {defineConfig} from 'vitepress';

export default defineConfig({
  lang:'ja-JP',title:'AstroForge API',description:'機体・フライト・PyLoN UDP API',base:'/docs/',
  cleanUrls:true,srcExclude:['validation.md','completion-audit.md','flight-update-validation.md'],
  themeConfig:{
    siteTitle:'AstroForge / API',
    nav:[{text:'ガイド',link:'/guide'},{text:'HTTP API',link:'/api/http'},{text:'UDP API',link:'/protocol'}],
    sidebar:[
      {text:'はじめに',items:[{text:'概要',link:'/'},{text:'クイックスタート',link:'/guide'}]},
      {text:'APIリファレンス',items:[{text:'HTTP / SSE',link:'/api/http'},{text:'機体とフライト状態',link:'/api/schema'},{text:'PyLoN UDP v1',link:'/protocol'}]},
      {text:'シミュレーション',items:[{text:'複数機体・衝突・時間倍率',link:'/simulation'},{text:'Zig物理カーネル',link:'/physics-kernel'}]}
    ],
    search:{provider:'local'},outline:{label:'このページ',level:[2,3]},
    docFooter:{prev:'前のページ',next:'次のページ'},footer:{message:'ローカルで組み立て、コードで飛ばす。'},
  },
});
