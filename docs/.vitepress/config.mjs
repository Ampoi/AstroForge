import {defineConfig} from 'vitepress';

export default defineConfig({
  lang:'ja-JP',title:'AstroForge',description:'起動方法、UDPでの飛行制御、テレメトリの読み方',base:'/docs/',
  cleanUrls:true,srcExclude:['validation.md','completion-audit.md','flight-update-validation.md'],
  themeConfig:{
    siteTitle:'AstroForge',
    nav:[{text:'はじめる',link:'/guide'},{text:'UDPで制御する',link:'/protocol'},{text:'貢献',link:'/contributing'}],
    socialLinks:[{icon:'github',link:'https://github.com/Ampoi/AstroForge',ariaLabel:'AstroForgeのGitHubリポジトリ'}],
    sidebar:[
      {text:'はじめに',items:[{text:'概要',link:'/'},{text:'クイックスタート',link:'/guide'},{text:'ローバー',link:'/rover'},{text:'センサー・可動機構・ROS2',link:'/systems'},{text:'外部PyLoN・ROS2接続',link:'/ros2'}]},
      {text:'UDPで制御する',items:[{text:'接続と通信の流れ',link:'/protocol'},{text:'送るコマンドと機体の挙動',link:'/udp/commands'},{text:'受け取るテレメトリ',link:'/udp/telemetry'},{text:'座標・高度の読み方',link:'/udp/coordinates'}]},
      {text:'さらに使いこなす',items:[{text:'複数機体・衝突・時間倍率',link:'/simulation'},{text:'HTTP / SSE',link:'/api/http'},{text:'機体とフライト状態',link:'/api/schema'}]},
      {text:'貢献',items:[{text:'開発・ビルド・コード構成',link:'/contributing'},{text:'Zig物理カーネル',link:'/physics-kernel'}]}
    ],
    search:{provider:'local'},outline:{label:'このページ',level:[2,3]},
    docFooter:{prev:'前のページ',next:'次のページ'},footer:{message:'ローカルで組み立て、コードで飛ばす。'},
  },
});
