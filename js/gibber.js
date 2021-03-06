let Gibber = {
  Utility:       require( './utility.js' ),
  Communication: require( './communication.js' ),
  Environment:   require( './environment.js' ),
  Scheduler:     require( './clock.js' ),
  Theory:        require( './theory.js' ),
  Examples:      require( './example.js' ),
  MIDI:          require( './MIDI.js' ),
  Channel:       null, 
  Gen:           null,
  Euclid:        null,
  Seq:           null,
  Score:         null,
  Pattern:       null,
  Arp:           null,
  WavePattern:   null,
  currentTrack:  null,
  codemirror:    null,
  max:           null,
  '$':           null,

  export() {
    window.Steps         = this.Steps
    window.Seq           = this.Seq
    window.Score         = this.Score
    window.Track         = this.Track
    window.Scheduler     = this.Scheduler
    window.Pattern       = this.Pattern
    window.Euclid        = this.Euclid
    window.Arp           = this.Arp
    window.Communication = this.Communication
    window.log           = this.log
    window.Theory        = this.Theory
    window.Scale         = this.Theory.Scale.master
    window.channels      = this.MIDI.channels
    window.Clock         = this.Scheduler
    window.log           = this.log
    window.WavePattern   = this.WavePattern
    
    Gibber.Gen.export( window )

    this.Utility.export( window )
  },

  init() {
    // XXX WATCH OUT
    this.Environment.debug = false

    this.$   = Gibber.Utility.create

    this.Environment.init( Gibber )
    this.Theory.init( Gibber )

    this.log = this.Environment.log

    this.Scheduler.init()

    if( this.Environment.debug ) {
      this.Scheduler.mockRun()
      
    }else{
      // AS LONG AS THIS DOESN'T RUN, NO ATTEMPT TO COMMUNICATE WITH LIVE IS MADE
      //this.Communication.init( Gibber ) 
      this.MIDI.init( Gibber )
      this.Scheduler.run()
    }

    this.initSingletons( window )

    this.export()
  },

  singleton( target, key ) {
    if( Array.isArray( key ) ) {
      for( let i = 0; i < key.length; i++ ) {
        Gibber.singleton( target, key[ i ] )
      }
      return
    }
    
    if( target[ key ] !== undefined ) {
      delete target[ key ]
    }

    let proxy = null
    Object.defineProperty( target, key, {
      get() { return proxy },
      set(v) {
        if( proxy && proxy.clear ) {
          proxy.clear()
        }

        proxy = v
      }
    })
  },

  initSingletons: function( target ) {
		var letters = "abcdefghijklmnopqrstuvwxyz"
    
		for(var l = 0; l < letters.length; l++) {

			var lt = letters.charAt(l);
      Gibber.singleton( target, lt )
      
    }
  },

  clear() {
    for( let i = 0; i < this.Seq._seqs.length; i++ ){
      this.Seq._seqs[ i ].clear()
    }
    
    //setTimeout( () => {
    //  for( let key in Gibber.currentTrack.markup.textMarkers ) {
    //    let marker = Gibber.currentTrack.markup.textMarkers[ key ]

    //    if( marker.clear ) marker.clear() 
    //  }
    //}, 500 )

    Gibber.MIDI.clear()
    Gibber.Gen.clear()
    Gibber.Environment.codeMarkup.clear()
  },

  addSequencingToMethod( obj, methodName, priority, overrideName ) {
    
    if( !obj.sequences ) obj.sequences = {}
    if( overrideName === undefined ) overrideName = methodName 
    
    let lastId = 0
    obj[ methodName ].seq = function( values, timings, id=0, delay=0 ) {
      let seq
      lastId = id

      if( obj.sequences[ methodName ] === undefined ) obj.sequences[ methodName ] = []

      if( obj.sequences[ methodName ][ id ] ) obj.sequences[ methodName ][ id ].clear()

      obj.sequences[ methodName ][ id ] = seq = Gibber.Seq( values, timings, overrideName, obj, priority )
      seq.trackID = obj.id

      if( id === 0 ) {
        obj[ methodName ].values  = obj.sequences[ methodName ][ 0 ].values
        obj[ methodName ].timings = obj.sequences[ methodName ][ 0 ].timings
      }

      obj[ methodName ][ id ] = seq

      seq.delay( delay )
      seq.start()

      //Gibber.Communication.send( `select_track ${obj.id}` )

      return seq
    }
    
    obj[ methodName ].seq.delay = v => obj[ methodName ][ lastId ].delay( v )

    obj[ methodName ].seq.stop = function() {
      obj.sequences[ methodName ][ 0 ].stop()
      return obj
    }

    obj[ methodName ].seq.start = function() {
      obj.sequences[ methodName ][ 0 ].start()
      return obj
    }


  },

  addSequencingToProtoMethod( proto, methodName ) {
    proto[ methodName ].seq = function( values, timings, id = 0 ) {

      if( this.sequences === undefined ) this.sequences = {}

      if( this.sequences[ methodName ] === undefined ) this.sequences[ methodName ] = []

      if( this.sequences[ methodName ][ id ] ) this.sequences[ methodName ][ id ].stop() 

      this.sequences[ methodName ][ id ] = Gibber.Seq( values, timings, methodName, this ).start() // 'this' will never be correct reference

      if( id === 0 ) {
        this.values  = this.sequences[ methodName ][ 0 ].values
        this.timings = this.sequences[ methodName ][ 0 ].timings
      }

      this[ id ] = this.sequences[ methodName ][ id ]
      
      this.seq.stop = function() {
        this.sequences[ methodName ][ 0 ].stop()
        return this
      }.bind( this )

      this.seq.start = function() {
        this.sequences[ methodName ][ 0 ].start()
        return this
      }.bind( this )
    }
  },

  addMethod( obj, methodName, channel, ccnum )  {
    let v = 0,//parameter.value,
        p,
        seqKey = `${channel} cc ${ccnum}`

    //console.log( "add method trackID", trackID )

    Gibber.Seq.proto.externalMessages[ seqKey ] = ( val, offset=null ) => {
      let msg = [ 0xb0 + channel, ccnum, val ]
      const baseTime = offset !== null ? window.performance.now() + offset : window.performance.now()

      Gibber.MIDI.send( msg, baseTime )
    }

    
    obj[ methodName ] = p = ( initialGraph, shouldTransform=true ) => {
      let transformedGraph = null, finishedGraph = null
      //if( p.properties.quantized === 1 ) _v = Math.round( _v )
      
      if( typeof initialGraph === 'object' ) initialGraph.isGen = typeof initialGraph.gen === 'function'

      if( initialGraph !== undefined ) {
        if( typeof initialGraph === 'object' && initialGraph.isGen ) {
          if( shouldTransform === true ) { // affine transform -1:1 to 0:127
            transformedGraph = Gibber.Gen.genish.clamp(
              Gibber.Gen.genish.floor(
                Gibber.Gen.genish.mul( 
                  Gibber.Gen.genish.div( 
                    Gibber.Gen.genish.add( 1, initialGraph ), 
                    2 
                  ), 
                127 
                ) 
              ),
            0, 127 )
          }

          finishedGraph = shouldTransform ?
            Gibber.Gen.genish.gen.createCallback( transformedGraph ) :
            Gibber.Gen.genish.gen.createCallback( initialGraph ) 


          Gibber.Gen.assignTrackAndParamID( finishedGraph, channel, ccnum )
          
          // if a gen is not already connected to this parameter, push
          if( Gibber.Gen.connected.find( e => e.ccnum === ccnum && e.channel === channel ) === undefined ) {
            Gibber.Gen.connected.push( finishedGraph )
          }

          Gibber.Gen.lastConnected = finishedGraph

          if( '__widget__' in initialGraph ) {
            initialGraph.__widget__.place()
          }
          
          // disconnects for fades etc.
          //if( typeof _v.shouldKill === 'object' ) {
          //  Gibber.Utility.future( ()=> {
          //    Gibber.Communication.send( `ungen ${parameter.id}` )
          //    Gibber.Communication.send( `set ${parameter.id} ${_v.shouldKill.final}` )

          //    let widget = Gibber.Environment.codeMarkup.genWidgets[ parameter.id ]
          //    if( widget !== undefined && widget.mark !== undefined ) {
          //      widget.mark.clear()
          //    }
          //    delete Gibber.Environment.codeMarkup.genWidgets[ parameter.id ]
          //  }, _v.shouldKill.after )
          //}
          
          v = finishedGraph
          v.isGen = true
        }else{
          // if there was a gen assigned and now a number is being assigned...
          if( v.isGen ) { 
            console.log( 'removing gen', v )
            let widget = Gibber.Environment.codeMarkup.genWidgets[ v.id ]

            if( widget !== undefined && widget.mark !== undefined ) {
              widget.mark.clear()
            }
            delete Gibber.Environment.codeMarkup.genWidgets[ v.id ]

          }

          v = initialGraph
          Gibber.Seq.proto.externalMessages[ seqKey ]( v )
          //Gibber.Communication.send( `set ${parameter.id} ${v}` )
        }
      }else{
        return v
      }
    }
    
    // solo cc output for midi mapping
    let soloing = false
    obj[ methodName ].solo = function() {
      if( soloing === false ) {
        Gibber.Gen.__solo = { channel, ccnum }
      }else{
        Gibber.Gen.__solo = null
      }

      soloing = !soloing
    }
    //p.properties = parameter

    Gibber.addSequencingToMethod( obj, methodName, 0, seqKey )
  }
}

Gibber.Pattern = require( './pattern.js' )( Gibber )
Gibber.Seq     = require( './seq.js' )( Gibber )
Gibber.Score   = require( './score.js' )( Gibber )
Gibber.Arp     = require( './arp.js' )( Gibber )
Gibber.Euclid  = require( './euclidean.js')( Gibber )
Gibber.Gen     = require( './modulation.js' )( Gibber )
Gibber.Steps   = require( './steps.js' )( Gibber )
Gibber.Channel = require( './channel.js')( Gibber )
Gibber.WavePattern = require( './wavePattern.js' )( Gibber )

module.exports = Gibber
